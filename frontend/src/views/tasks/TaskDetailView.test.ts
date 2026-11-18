import {createPinia} from 'pinia'
import {ref, type SetupContext} from 'vue'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {QueryClient, VueQueryPlugin} from '@tanstack/vue-query'
import {enableAutoUnmount, flushPromises, shallowMount, type VueWrapper} from '@vue/test-utils'
import {createMemoryHistory, createRouter, type RouteLocationRaw} from 'vue-router'

const sdk = vi.hoisted(() => ({
	tasksRead: vi.fn(),
	patchTasksRead: vi.fn(),
	tasksList: vi.fn(async () => ({data: {items: []}})),
	projectTasksList: vi.fn(async () => ({data: {items: []}})),
	projectViewTasksList: vi.fn(async () => ({data: {items: []}})),
	projectViewBucketsTasksList: vi.fn(async () => ({data: {items: []}})),
	bucketsList: vi.fn(async () => ({data: {items: []}})),
	tasksOccurrencesPreview: vi.fn(),
}))
vi.mock('@/client/generated', () => sdk)
const message = vi.hoisted(() => ({error: vi.fn(), success: vi.fn()}))
vi.mock('@/message', () => message)
const projects = vi.hoisted(() => ({} as Record<number, unknown>))
vi.mock('@/composables/useProjects', () => ({useProjects: () => ({projects})}))
vi.mock('@/composables/useLabels', () => ({useLabels: () => ({filterLabelsByQuery: () => [], isPending: {value: false}, getLabelById: vi.fn()})}))
vi.mock('vue-i18n', async importOriginal => ({
	...await importOriginal<typeof import('vue-i18n')>(),
	useI18n: () => ({
		t: (key: string, named?: Record<string, unknown>) => named ? `${key}:${JSON.stringify(named)}` : key,
		locale: ref('en'),
	}),
}))

vi.mock('@/i18n/lang/en.json', () => ({default: {}}))

import type {PreviewAnswer} from '@/client/generated'
import {isRefusal, previewFixtures} from '@/client/queries/occurrencePreview.fixtures'
import {ApiError} from '@/client/problem'
import BaseButton from '@/components/base/BaseButton.vue'
import ProjectInTrashNotice from '@/components/project/ProjectInTrashNotice.vue'
import TaskInTrashNotice from '@/components/tasks/partials/TaskInTrashNotice.vue'
import {mapTaskEverywhere} from '@/client/queries/taskCache'
import {taskKeys} from '@/client/queries/tasks'
import EditLabels from '@/components/tasks/partials/EditLabels.vue'
import Heading from '@/components/tasks/partials/Heading.vue'
import PercentDoneSelect from '@/components/tasks/partials/PercentDoneSelect.vue'
import Datepicker from '@/components/input/Datepicker.vue'
import RelatedTasks from '@/components/tasks/partials/RelatedTasks.vue'
import RepeatAfter from '@/components/tasks/partials/RepeatAfter.vue'
import {SHORTCUTS} from '@/constants/shortcuts'
import {parseKey} from '@/helpers/shortcut'
import TaskDetailView from './TaskDetailView.vue'

enableAutoUnmount(afterEach)

beforeEach(() => {
	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
	vi.setSystemTime(new Date('2024-01-01T08:00:00Z'))
	sdk.tasksOccurrencesPreview.mockReset()
	sdk.tasksOccurrencesPreview.mockImplementation(async () => ({data: answerOf('P-10')}))
})

afterEach(() => {
	queryClient?.clear()
	vi.useRealTimers()
})

function answerOf(row: string): PreviewAnswer {
	const answer = previewFixtures.find(fixture => fixture.row === row)?.answer
	if (!answer || isRefusal(answer)) throw new Error(`no answer for ${row}`)
	return answer
}

function serverTask(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Task ${id}`,
		description: '',
		done: false,
		project_id: 1,
		percent_done: 0.25,
		due_date: '2024-01-01T10:00:00Z',
		labels: [{id: 1, title: 'First'}],
		assignees: [],
		max_permission: 2,
		...overrides,
	}
}

let queryClient: QueryClient

function dueDatePicker(wrapper: VueWrapper) {
	return wrapper.findAllComponents(Datepicker)[0]!
}

async function mountDetail(taskId = 1, {visited = [], backdropView, stubs = {}}: {visited?: RouteLocationRaw[], backdropView?: string, stubs?: Record<string, unknown>} = {}) {
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{path: '/', component: {render: () => null}},
			{path: '/tasks/:id', name: 'task.detail', component: {render: () => null}},
			{path: '/projects/:projectId', name: 'project.index', component: {render: () => null}},
			{path: '/:pathMatch(.*)*', name: 'not-found', component: {render: () => null}},
		],
	})
	await router.push('/')
	for (const location of visited) {
		await router.push(location)
	}
	const wrapper = shallowMount(TaskDetailView, {
		attachTo: document.body,
		props: {
			taskId,
			backdropView,
		},
		global: {
			plugins: [createPinia(), router, [VueQueryPlugin, {queryClient}]],
			mocks: {$t: (key: string) => key},
			stubs: {Icon: true, XButton: true, Modal: true, TaskPropertyRow: false, CustomTransition: {template: '<div><slot/></div>'}, ...stubs},
			directives: {tooltip: () => {}, cy: () => {}, shortcut: () => {}},
		},
	})
	await flushPromises()
	return wrapper
}

describe('TaskDetailView draft', () => {
	beforeEach(() => {
		sdk.tasksRead.mockReset()
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task)}))
		sdk.patchTasksRead.mockReset()
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1)}))
	})

	it('keeps unsaved edits when the cached task changes and follows mutation-owned fields', async () => {
		const wrapper = await mountDetail()
		expect(dueDatePicker(wrapper).props('modelValue')).toEqual(new Date('2024-01-01T10:00:00Z'))

		dueDatePicker(wrapper).vm.$emit('update:modelValue', new Date('2024-02-02T10:00:00Z'))
		await flushPromises()

		mapTaskEverywhere(queryClient, 1, task => ({...task, is_unread: true, labels: [{id: 1, title: 'First'}, {id: 2, title: 'Second'}]}))
		await flushPromises()

		expect(sdk.patchTasksRead).not.toHaveBeenCalled()
		expect(dueDatePicker(wrapper).props('modelValue')).toEqual(new Date('2024-02-02T10:00:00Z'))
		expect(wrapper.findComponent(EditLabels).props('modelValue')).toEqual([{id: 1, title: 'First'}, {id: 2, title: 'Second'}])
	})

	it('reseeds the draft when the task id changes', async () => {
		const wrapper = await mountDetail()
		dueDatePicker(wrapper).vm.$emit('update:modelValue', new Date('2024-02-02T10:00:00Z'))
		await flushPromises()

		await wrapper.setProps({taskId: 2})
		await flushPromises()

		expect(dueDatePicker(wrapper).props('modelValue')).toEqual(new Date('2024-01-01T10:00:00Z'))
	})

	it('reseeds the draft from the response of a save', async () => {
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, {percent_done: 0.9, due_date: '2024-03-03T10:00:00Z'})}))
		const wrapper = await mountDetail()

		wrapper.findComponent(PercentDoneSelect).vm.$emit('update:modelValue', 0.9)
		await flushPromises()

		expect(sdk.patchTasksRead).toHaveBeenCalledOnce()
		expect(wrapper.findAllComponents(Datepicker)[0]?.props('modelValue')).toEqual(new Date('2024-03-03T10:00:00Z'))
	})

	it('never shows the response of a save on another task opened meanwhile', async () => {
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, path.task === 2
			? {due_date: '2025-05-05T10:00:00Z', percent_done: 0.5}
			: {})}))
		let respond: (value: unknown) => void = () => {}
		sdk.patchTasksRead.mockImplementation(() => new Promise(resolve => {
			respond = resolve
		}))
		const wrapper = await mountDetail()

		wrapper.findComponent(PercentDoneSelect).vm.$emit('update:modelValue', 0.9)
		await flushPromises()
		await wrapper.setProps({taskId: 2})
		await flushPromises()
		expect(dueDatePicker(wrapper).props('modelValue')).toEqual(new Date('2025-05-05T10:00:00Z'))

		respond({data: serverTask(1, {percent_done: 0.9, due_date: '2024-03-03T10:00:00Z'})})
		await flushPromises()

		expect(sdk.patchTasksRead).toHaveBeenCalledOnce()
		expect(dueDatePicker(wrapper).props('modelValue')).toEqual(new Date('2025-05-05T10:00:00Z'))
		expect(wrapper.findComponent(PercentDoneSelect).props('modelValue')).toBe(0.5)
	})
})

describe('TaskDetailView repeat', () => {
	const rule = {
		freq: 'weekly',
		interval: 2,
	}

	beforeEach(() => {
		sdk.tasksRead.mockReset()
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, {
			repeat: rule,
			repeats_from_current_date: true,
		})}))
		sdk.patchTasksRead.mockReset()
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1)}))
	})

	function removeButton(wrapper: VueWrapper) {
		return wrapper.findAllComponents({name: 'BaseButton'})
			.find(button => button.attributes('aria-label') === 'task.detail.removeRepeat')
	}

	it('shows the editor for a task with a rule', async () => {
		const wrapper = await mountDetail()

		expect(wrapper.findComponent(RepeatAfter).props('modelValue')).toMatchObject({repeat: rule})
		expect(wrapper.findComponent(RepeatAfter).props('startOpen')).toBe(false)
	})

	it('mounts a fresh editor for each task', async () => {
		const wrapper = await mountDetail()
		const first = wrapper.findComponent(RepeatAfter).vm

		await wrapper.setProps({taskId: 2})
		await flushPromises()

		expect(wrapper.findComponent(RepeatAfter).props('modelValue')).toMatchObject({id: 2})
		expect(wrapper.findComponent(RepeatAfter).vm).not.toBe(first)
	})

	it('clears the rule with an explicit null and keeps the row, now unset', async () => {
		const wrapper = await mountDetail()

		removeButton(wrapper)!.vm.$emit('click')
		await flushPromises()

		expect(sdk.patchTasksRead).toHaveBeenCalledOnce()
		expect(sdk.patchTasksRead.mock.calls[0]![0].body).toEqual(expect.arrayContaining([
			{op: 'add', path: '/repeat', value: null},
			{op: 'add', path: '/repeats_from_current_date', value: false},
		]))
		expect(wrapper.find('.property-repeat').classes()).not.toContain('is-set')
	})
})

describe('TaskDetailView mark done and go back', () => {
	beforeEach(() => {
		for (const id of Object.keys(projects)) {
			delete projects[Number(id)]
		}
		sdk.tasksRead.mockReset()
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task)}))
		sdk.patchTasksRead.mockReset()
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, {done: true})}))
	})

	function pressShiftT() {
		document.body.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyT', key: 'T', shiftKey: true, bubbles: true}))
	}

	it('marks the task done and returns to the project list it was opened from', async () => {
		projects[5] = {id: 5, title: 'Origin'}
		const wrapper = await mountDetail(1, {visited: ['/projects/5', {path: '/tasks/1', state: {back: '/projects/5'}}]})

		pressShiftT()
		await flushPromises()
		await vi.waitFor(() => expect(wrapper.vm.$router.currentRoute.value.path).toBe('/projects/5'))

		expect(sdk.patchTasksRead).toHaveBeenCalledOnce()
		expect(sdk.patchTasksRead.mock.calls[0]![0].body).toContainEqual({op: 'add', path: '/done', value: true})
	})

	it('falls back to the task project when opened directly', async () => {
		const wrapper = await mountDetail(1, {visited: ['/tasks/1']})

		pressShiftT()
		await flushPromises()

		expect(wrapper.vm.$router.currentRoute.value.path).toBe('/projects/1')
	})

	it('stays on the task when saving fails', async () => {
		sdk.patchTasksRead.mockRejectedValue(new Error('nope'))
		const wrapper = await mountDetail(1, {visited: ['/tasks/1']})

		pressShiftT()
		await flushPromises()

		expect(sdk.patchTasksRead).toHaveBeenCalledOnce()
		expect(message.error).toHaveBeenCalled()
		expect(wrapper.vm.$router.currentRoute.value.path).toBe('/tasks/1')
	})

	it('does nothing for a task that is already done', async () => {
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, {done: true})}))
		const wrapper = await mountDetail(1, {visited: ['/tasks/1']})

		pressShiftT()
		await flushPromises()

		expect(sdk.patchTasksRead).not.toHaveBeenCalled()
		expect(wrapper.vm.$router.currentRoute.value.path).toBe('/tasks/1')
	})
})

describe('TaskDetailView repeat row', () => {
	const rule = {freq: 'weekly', interval: 2}

	const RepeatAfterStub = {
		name: 'RepeatAfter',
		props: ['modelValue', 'save', 'writeOutcome', 'disabled', 'startOpen'],
		setup(_: unknown, {expose}: SetupContext) {
			expose({cancelPreview: () => {}, focus: () => {}})
			return () => null
		},
	}

	function serve(overrides: Record<string, unknown> = {}) {
		sdk.tasksRead.mockReset()
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, overrides)}))
		sdk.patchTasksRead.mockReset()
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, overrides)}))
	}

	function editor(wrapper: VueWrapper) {
		return wrapper.findComponent({name: 'RepeatAfter'})
	}

	function removeButton(wrapper: VueWrapper) {
		return wrapper.findAllComponents({name: 'BaseButton'})
			.find(button => button.attributes('aria-label') === 'task.detail.removeRepeat')
	}

	function pressLabelsShortcut(target: EventTarget = document.body) {
		const {code} = parseKey(SHORTCUTS.taskDetail.labels)
		const event = new KeyboardEvent('keydown', {key: code, code, bubbles: true, cancelable: true})
		target.dispatchEvent(event)
		return event
	}

	it('hands the editor its save, outcome and write access', async () => {
		serve({repeat: rule})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(editor(wrapper).props('save')).toBeTypeOf('function')
		expect(editor(wrapper).props('writeOutcome')).toBeNull()
		expect(editor(wrapper).props('disabled')).toBe(false)
		expect(editor(wrapper).props('startOpen')).toBeFalsy()
		expect(wrapper.find('.property-repeat').classes()).toContain('is-set')
	})

	it('offers the empty row to someone who can edit', async () => {
		serve({repeat: null})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(editor(wrapper).exists()).toBe(true)
		expect(wrapper.find('.property-repeat').classes()).not.toContain('is-set')
		expect(removeButton(wrapper)).toBeUndefined()
	})

	it.each([
		{permission: 0, canEdit: false},
		{permission: 1, canEdit: true},
	])('enforces repeat editor access for a link share with permission $permission', async ({permission, canEdit}) => {
		serve({repeat: rule, max_permission: permission})
		const wrapper = await mountDetail(1, {stubs: {
			RepeatAfter: false,
			SimpleButton: false,
			BaseButton: false,
			Popup: {
				props: ['open'],
				template: '<div><slot name="trigger" :toggle="() => $emit(\'update:open\', !open)" /></div>',
			},
		}})
		const trigger = editor(wrapper).find<HTMLButtonElement>('.repeat-field-trigger')

		expect(trigger.element.disabled).toBe(!canEdit)
		trigger.element.click()
		await flushPromises()

		expect(trigger.attributes('aria-expanded')).toBe(String(canEdit))
		expect(editor(wrapper).emitted('update:open') ?? []).toEqual(canEdit ? [[true]] : [])
		expect(sdk.patchTasksRead).not.toHaveBeenCalled()
	})

	it('shows a stored rule to a read-only viewer without letting them edit or remove it', async () => {
		serve({repeat: rule, max_permission: 0})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(wrapper.find('.property-repeat').classes()).toContain('is-set')
		expect(editor(wrapper).props('disabled')).toBe(true)
		expect(removeButton(wrapper)).toBeUndefined()
	})

	it('hides the row from a read-only viewer when there is no rule', async () => {
		serve({repeat: null, max_permission: 0})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(wrapper.find('.property-repeat').exists()).toBe(false)
	})

	it('treats a locked projection with no frequency as a stored rule', async () => {
		serve({repeat: {read_only: true}})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(wrapper.find('.property-repeat').classes()).toContain('is-set')
		expect(removeButton(wrapper)).toBeDefined()

		removeButton(wrapper)!.vm.$emit('click')
		await flushPromises()

		expect(sdk.patchTasksRead).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
			path: {task: 1},
			body: expect.arrayContaining([
				{op: 'add', path: '/repeat', value: null},
				{op: 'add', path: '/repeats_from_current_date', value: false},
			]),
		}))
	})

	it('shows a locked projection with no frequency to a read-only viewer', async () => {
		serve({repeat: {read_only: true}, max_permission: 0})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(wrapper.find('.property-repeat').classes()).toContain('is-set')
		expect(editor(wrapper).props('disabled')).toBe(true)
	})

	it('runs task shortcuts while the editor is closed', async () => {
		serve({repeat: rule})
		await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		expect(pressLabelsShortcut().defaultPrevented).toBe(true)
	})

	it('keeps task shortcuts from acting behind the open editor, from a focused preset button too', async () => {
		serve({repeat: rule})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})
		editor(wrapper).vm.$emit('update:open', true)
		await flushPromises()
		const preset = document.body.appendChild(document.createElement('button'))
		preset.focus()

		expect(pressLabelsShortcut(preset).defaultPrevented).toBe(false)

		preset.remove()
		editor(wrapper).vm.$emit('update:open', false)
		await flushPromises()
		expect(pressLabelsShortcut().defaultPrevented).toBe(true)
	})

	it('does not carry an open editor over to the next task', async () => {
		serve({repeat: rule})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})
		const first = editor(wrapper).vm
		editor(wrapper).vm.$emit('update:open', true)

		await wrapper.setProps({taskId: 2})
		await flushPromises()

		expect(editor(wrapper).vm).not.toBe(first)
		expect(pressLabelsShortcut().defaultPrevented).toBe(true)
	})
})

describe('TaskDetailView repeat save', () => {
	const rule = {freq: 'daily'}
	const cancelPreview = vi.fn()
	// Records what the view hands the editor and answers the preview cancel it calls after a save.
	const RepeatAfterStub = {
		name: 'RepeatAfter',
		props: ['modelValue', 'save', 'writeOutcome', 'disabled', 'startOpen'],
		setup(_: unknown, {expose}: SetupContext) {
			expose({cancelPreview, focus: () => {}})
			return () => null
		},
	}

	beforeEach(() => {
		for (const id of Object.keys(projects)) {
			delete projects[Number(id)]
		}
		cancelPreview.mockReset()
		message.error.mockReset()
		sdk.tasksRead.mockReset()
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, {due_date: null, repeat: rule})}))
		sdk.patchTasksRead.mockReset()
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, {
			due_date: '2024-01-02T09:00:00Z',
			due_date_source: 'generated',
			repeat: rule,
		})}))
	})

	function editor(wrapper: VueWrapper) {
		return wrapper.findComponent({name: 'RepeatAfter'})
	}

	function saveFromEditor(wrapper: VueWrapper, options: {initialDueTime?: string}, repeat: object = rule) {
		const save = editor(wrapper).props('save') as (task: unknown, options: unknown) => Promise<unknown>
		return save({...(editor(wrapper).props('modelValue') as object), repeat}, options)
	}

	function patchOps(call = 0) {
		return (sdk.patchTasksRead.mock.calls[call]![0] as {body: {op: string, path: string, value: unknown}[]}).body
	}

	function paths(call = 0) {
		return patchOps(call).map(op => op.path)
	}

	it('sends the fixed time and no due date when the editor saves a rule on an undated task, then shows the server\'s date once', async () => {
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		await expect(saveFromEditor(wrapper, {initialDueTime: '09:00'})).resolves.toEqual({ok: true, outcome: {dueDateSource: 'generated', reason: undefined}})
		await flushPromises()

		expect(patchOps()).toContainEqual({op: 'add', path: '/initial_due_time', value: '09:00'})
		expect(paths()).not.toContain('/due_date')
		expect(dueDatePicker(wrapper).props('modelValue')).toEqual(new Date('2024-01-02T09:00:00Z'))
		expect(editor(wrapper).props('writeOutcome')).toEqual({dueDateSource: 'generated', reason: undefined})
		expect(editor(wrapper).props('modelValue')).not.toHaveProperty('due_date_source')
		expect(cancelPreview).toHaveBeenCalledOnce()

		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, {due_date: '2024-01-02T09:00:00Z', repeat: rule, percent_done: 0.9})}))
		wrapper.findComponent(PercentDoneSelect).vm.$emit('update:modelValue', 0.9)
		await flushPromises()

		expect(paths(1)).not.toContain('/initial_due_time')
		expect(editor(wrapper).props('writeOutcome')).toBeNull()
	})

	it('passes on the server\'s reason when it found no date', async () => {
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, {due_date: null, repeat: rule, reason: 'until_passed'})}))
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		await saveFromEditor(wrapper, {initialDueTime: '09:00'})
		await flushPromises()

		expect(editor(wrapper).props('writeOutcome')).toEqual({dueDateSource: undefined, reason: 'until_passed'})
		expect(editor(wrapper).props('modelValue')).toMatchObject({due_date: null, repeat: rule})
	})

	it('forgets the notice when another task opens', async () => {
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})
		await saveFromEditor(wrapper, {initialDueTime: '09:00'})
		await flushPromises()

		await wrapper.setProps({taskId: 2})
		await flushPromises()

		expect(editor(wrapper).props('modelValue')).toMatchObject({id: 2})
		expect(editor(wrapper).props('writeOutcome')).toBeNull()
	})

	it('keeps the task and shows no notice when the save changed nothing', async () => {
		sdk.patchTasksRead.mockResolvedValue({data: undefined, error: '', response: {status: 304}})
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		await expect(saveFromEditor(wrapper, {initialDueTime: '09:00'}, {freq: 'weekly'})).resolves.toMatchObject({ok: true})
		await flushPromises()

		expect(editor(wrapper).props('writeOutcome')).toBeNull()
		expect(editor(wrapper).props('modelValue')).toMatchObject({title: 'Task 1', due_date: null, repeat: rule})
	})

	it('tells the editor a failed save failed, so it keeps the draft', async () => {
		sdk.patchTasksRead.mockRejectedValue(new Error('nope'))
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		await expect(saveFromEditor(wrapper, {initialDueTime: '09:00'})).resolves.toMatchObject({ok: false})
		expect(message.error).toHaveBeenCalledTimes(1)
		expect(cancelPreview).not.toHaveBeenCalled()
		expect(editor(wrapper).props('writeOutcome')).toBeNull()
	})

	it('sends no initial due time on a title save', async () => {
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub, Heading: false, BaseButton: false}})

		const title = wrapper.findComponent(Heading).find('h1')
		title.element.textContent = 'Renamed'
		await title.trigger('blur')
		await flushPromises()

		expect(patchOps()).toContainEqual({op: 'add', path: '/title', value: 'Renamed'})
		expect(paths()).not.toContain('/initial_due_time')
		expect(editor(wrapper).props('writeOutcome')).toBeNull()
	})

	it('sends no initial due time when the clear-date button clears a repeating task\'s date', async () => {
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, {repeat: rule})}))
		const wrapper = await mountDetail(1, {stubs: {RepeatAfter: RepeatAfterStub}})

		wrapper.findAllComponents({name: 'BaseButton'})
			.find(button => button.attributes('aria-label') === 'task.detail.removeDueDate')!
			.vm.$emit('click')
		await flushPromises()

		expect(patchOps()).toContainEqual({op: 'add', path: '/due_date', value: '0001-01-01T00:00:00Z'})
		expect(paths()).not.toContain('/initial_due_time')
	})

	it('sends no initial due time when an undated repeating task is marked done', async () => {
		const wrapper = await mountDetail(1, {visited: ['/tasks/1'], stubs: {RepeatAfter: RepeatAfterStub}})

		document.body.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyT', key: 'T', shiftKey: true, bubbles: true}))
		await flushPromises()

		expect(wrapper.vm.$router.currentRoute.value.path).toBe('/projects/1')
		expect(patchOps()).toContainEqual({op: 'add', path: '/done', value: true})
		expect(paths()).not.toContain('/initial_due_time')
	})
})

describe('TaskDetailView in a trashed project', () => {
	it.each([
		{
			mode: 'standalone',
			backdropView: undefined,
		},
		{
			mode: 'modal',
			backdropView: '/projects/2',
		},
	])('shows the project notice in $mode mode without leaving the task route', async ({backdropView}) => {
		message.error.mockClear()
		const inTrash = {
			id: 1,
			deleted_at: '2026-01-01T00:00:00Z',
			can_restore: true,
			can_restore_root: false,
		}
		sdk.tasksRead.mockRejectedValue(new ApiError({
			status: 404,
			code: 3018,
			detail: 'project in trash',
			details: inTrash,
		}))
		const wrapper = await mountDetail(1, {visited: ['/tasks/1'], backdropView})

		expect(message.error).not.toHaveBeenCalled()
		expect(wrapper.findComponent(ProjectInTrashNotice).props('inTrash')).toEqual(inTrash)
		expect(wrapper.findComponent(TaskInTrashNotice).exists()).toBe(false)
		expect(wrapper.classes()).not.toContain('is-loading')
		expect(wrapper.vm.$router.currentRoute.value.path).toBe('/tasks/1')
		if (backdropView) {
			const close = wrapper.findComponent(BaseButton)
			expect(close.attributes('aria-label')).toBe('misc.close')
			close.vm.$emit('click')
			expect(wrapper.emitted('close')).toHaveLength(1)
		}
	})

	it('restores focus when restoring the project reveals a task still in the trash', async () => {
		const projectInTrash = {
			id: 1,
			deleted_at: '2026-01-01T00:00:00Z',
			can_restore: true,
			can_restore_root: false,
		}
		const taskInTrash = {
			id: 1,
			project_id: 1,
			deleted_at: '2026-01-01T00:00:00Z',
			can_restore: true,
		}
		sdk.tasksRead.mockRejectedValueOnce(new ApiError({
			status: 404,
			code: 3018,
			detail: 'project in trash',
			details: projectInTrash,
		})).mockRejectedValue(new ApiError({
			status: 404,
			code: 4040,
			detail: 'task in trash',
			details: taskInTrash,
		}))
		const wrapper = await mountDetail(1, {visited: ['/tasks/1']})
		const projectNotice = wrapper.findComponent(ProjectInTrashNotice).element as HTMLElement
		projectNotice.tabIndex = -1
		projectNotice.focus()
		expect(document.activeElement).toBe(projectNotice)

		await queryClient.invalidateQueries({queryKey: taskKeys.details})
		await flushPromises()

		expect(wrapper.findComponent(TaskInTrashNotice).props('inTrash')).toEqual(taskInTrash)
		expect(document.activeElement).toBe(wrapper.element)
	})
})

describe('TaskDetailView property sidebar', () => {
	beforeEach(() => {
		sdk.tasksRead.mockReset()
		sdk.patchTasksRead.mockReset()
	})

	function serve(overrides: Record<string, unknown> = {}) {
		sdk.tasksRead.mockImplementation(async ({path}: {path: {task: number}}) => ({data: serverTask(path.task, overrides)}))
		sdk.patchTasksRead.mockImplementation(async () => ({data: serverTask(1, overrides)}))
	}

	const renderButtons = {BaseButton: {template: '<button><slot/></button>'}}

	it('keeps a section the user opened visible after saving another field', async () => {
		serve()
		const wrapper = await mountDetail()
		expect(wrapper.findComponent(RelatedTasks).exists()).toBe(false)

		document.body.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyR', key: 'r', bubbles: true}))
		await flushPromises()
		expect(wrapper.findComponent(RelatedTasks).exists()).toBe(true)

		wrapper.findComponent(PercentDoneSelect).vm.$emit('update:modelValue', 0.9)
		await flushPromises()

		expect(sdk.patchTasksRead).toHaveBeenCalledOnce()
		expect(wrapper.findComponent(RelatedTasks).exists()).toBe(true)
	})

	it('shows every property row to users who can edit the task', async () => {
		serve({due_date: '', labels: []})
		const wrapper = await mountDetail()

		expect(wrapper.find('.property-due-date').exists()).toBe(true)
		expect(wrapper.find('.property-labels').exists()).toBe(true)
		expect(wrapper.find('.property-due-date').classes()).not.toContain('is-set')
	})

	it('only shows rows with a value to read-only users', async () => {
		serve({max_permission: 0, labels: []})
		const wrapper = await mountDetail()

		expect(wrapper.find('.property-due-date').classes()).toContain('is-set')
		expect(wrapper.find('.property-percent-done').exists()).toBe(true)
		expect(wrapper.find('.property-labels').exists()).toBe(false)
		expect(wrapper.find('.property-priority').exists()).toBe(false)
		expect(wrapper.find('.sidebar-toolbar').exists()).toBe(false)
	})
})
