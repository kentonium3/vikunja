import type {Locator, Page} from '@playwright/test'
import {test, expect} from '../../support/fixtures'
import {ProjectFactory} from '../../factories/project'
import {TaskFactory} from '../../factories/task'

const WINDOWS = [
	{width: 1280, height: 720},
	{width: 1440, height: 900},
]
const DATE_ROWS = ['due-date', 'start-date', 'end-date']
const DATE = '2030-06-15T12:00:00Z'

// Counts the buttons in the toolbar whose centre is painted by the open picker instead of the button.
function coveredToolbarButtons(toolbar: Locator) {
	return toolbar.evaluate(element => [...element.querySelectorAll('button')]
		.filter(button => getComputedStyle(button).visibility === 'visible' && button.offsetParent !== null)
		.filter(button => {
			const box = button.getBoundingClientRect()
			const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
			return top !== null && top.closest('.datepicker-popup') !== null
		}).length)
}

async function openDescriptionEditor(page: Page) {
	await page.locator('.tiptap__task-description').getByRole('button', {name: 'Edit', exact: true}).click()
	const toolbar = page.locator('.tiptap__task-description .editor-toolbar')
	await expect(toolbar).toBeVisible()
	return toolbar
}

test.describe('Date picker over the task description editor', () => {
	test.beforeEach(async ({authenticatedPage}) => {
		await ProjectFactory.create(1)
		await TaskFactory.create(1, {
			id: 1,
			index: 1,
			description: 'Some description',
			due_date: DATE,
			start_date: DATE,
			end_date: DATE,
		})
		await authenticatedPage.goto('/tasks/1')
	})

	for (const size of WINDOWS) {
		for (const row of DATE_ROWS) {
			test(`${row} leaves the formatting bar clear at ${size.width}x${size.height}`, async ({authenticatedPage: page}) => {
				await page.setViewportSize(size)
				const toolbar = await openDescriptionEditor(page)

				await page.locator(`.property-${row} .datepicker button.show`).click()
				await expect(page.locator('.datepicker-popup')).toBeVisible()

				expect(await coveredToolbarButtons(toolbar)).toBe(0)
			})
		}

		test(`a reminder date leaves the formatting bar clear at ${size.width}x${size.height}`, async ({authenticatedPage: page}) => {
			await page.setViewportSize(size)
			const toolbar = await openDescriptionEditor(page)

			await page.locator('.property-reminders').getByRole('button', {name: 'Add a reminder…'}).click()
			await page.getByRole('button', {name: 'Date and time'}).click()
			await expect(page.locator('.datepicker-popup')).toBeVisible()

			expect(await coveredToolbarButtons(toolbar)).toBe(0)
		})
	}

	test('every control of the narrow picker can be reached in a short window', async ({authenticatedPage: page}) => {
		await page.setViewportSize({width: 1280, height: 720})
		await page.locator('.property-due-date .datepicker button.show').click()

		await expect(page.locator('.datepicker-popup .calendar-month')).toBeInViewport({ratio: 1})
		const close = page.locator('.datepicker-popup .datepicker__close-button')
		await close.scrollIntoViewIfNeeded()
		await expect(close).toBeInViewport()
		await close.click()
		await expect(page.locator('.datepicker-popup')).toBeHidden()
	})

	test('the last quick-select chip can be scrolled to and used', async ({authenticatedPage: page}) => {
		await page.setViewportSize({width: 1280, height: 720})
		await page.locator('.property-due-date .datepicker button.show').click()

		const last = page.locator('.datepicker-popup .datepicker__quick-select-date').filter({hasText: 'In a Month'})
		await last.scrollIntoViewIfNeeded()
		await expect(last).toBeInViewport({ratio: 1})
		await last.click()
		await expect(page.locator('.datepicker-popup__summary')).not.toContainText('2030')
	})
})
