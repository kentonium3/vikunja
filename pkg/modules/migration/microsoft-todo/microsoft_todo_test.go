// Vikunja is a to-do list application to facilitate your life.
// Copyright 2018-present Vikunja and contributors. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package microsofttodo

import (
	"testing"
	"time"

	"code.vikunja.io/api/pkg/models"

	"github.com/d4l3k/messagediff"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/teambition/rrule-go"
)

func TestConvertMicrosoftRecurrence(t *testing.T) {
	cases := []struct {
		name string
		rec  *recurrence
		want string
	}{
		{"nil recurrence", nil, ""},
		{"nil pattern", &recurrence{}, ""},
		{"daily", &recurrence{Pattern: &pattern{Type: "daily", Interval: 1}}, "FREQ=DAILY;INTERVAL=1"},
		{"daily every 3", &recurrence{Pattern: &pattern{Type: "daily", Interval: 3}}, "FREQ=DAILY;INTERVAL=3"},
		{"interval defaults to 1", &recurrence{Pattern: &pattern{Type: "daily", Interval: 0}}, "FREQ=DAILY;INTERVAL=1"},
		{"weekly with days", &recurrence{Pattern: &pattern{Type: "weekly", Interval: 1, DaysOfWeek: []string{"monday", "friday"}}}, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR"},
		{"weekly no days", &recurrence{Pattern: &pattern{Type: "weekly", Interval: 2}}, "FREQ=WEEKLY;INTERVAL=2"},
		{"absolute monthly", &recurrence{Pattern: &pattern{Type: "absoluteMonthly", Interval: 1, DayOfMonth: 15}}, "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15"},
		{"relative monthly", &recurrence{Pattern: &pattern{Type: "relativeMonthly", Interval: 1, DaysOfWeek: []string{"tuesday"}, Index: "second"}}, "FREQ=MONTHLY;INTERVAL=1;BYDAY=TU;BYSETPOS=2"},
		{"relative monthly last", &recurrence{Pattern: &pattern{Type: "relativeMonthly", Interval: 1, DaysOfWeek: []string{"friday"}, Index: "last"}}, "FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1"},
		{"absolute yearly", &recurrence{Pattern: &pattern{Type: "absoluteYearly", Interval: 1, Month: 3, DayOfMonth: 14}}, "FREQ=YEARLY;INTERVAL=1;BYMONTH=3;BYMONTHDAY=14"},
		{"relative yearly", &recurrence{Pattern: &pattern{Type: "relativeYearly", Interval: 1, Month: 11, DaysOfWeek: []string{"thursday"}, Index: "fourth"}}, "FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYDAY=TH;BYSETPOS=4"},
		{"legacy monthly alias", &recurrence{Pattern: &pattern{Type: "monthly", Interval: 1}}, "FREQ=MONTHLY;INTERVAL=1"},
		{"legacy yearly alias", &recurrence{Pattern: &pattern{Type: "yearly", Interval: 1}}, "FREQ=YEARLY;INTERVAL=1"},
		{"range end date", &recurrence{Pattern: &pattern{Type: "daily", Interval: 1}, Range: &taskRange{Type: "endDate", EndDate: "2026-12-31"}}, "FREQ=DAILY;INTERVAL=1;UNTIL=20261231T235959Z"},
		{"range numbered", &recurrence{Pattern: &pattern{Type: "daily", Interval: 1}, Range: &taskRange{Type: "numbered", NumberOfOccurrences: 5}}, "FREQ=DAILY;INTERVAL=1;COUNT=5"},
		{"range noEnd ignored", &recurrence{Pattern: &pattern{Type: "daily", Interval: 1}, Range: &taskRange{Type: "noEnd"}}, "FREQ=DAILY;INTERVAL=1"},
		{"unknown type", &recurrence{Pattern: &pattern{Type: "somethingelse", Interval: 1}}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := convertMicrosoftRecurrence(c.rec)
			assert.Equal(t, c.want, got)
			if got != "" {
				_, err := rrule.StrToROption(got)
				assert.NoError(t, err, "generated RRULE should be parseable")
			}
		})
	}
}

func TestConverting(t *testing.T) {

	testtime := &dateTimeTimeZone{
		DateTime: "2020-12-18T03:00:00.4770000",
		TimeZone: "UTC",
	}

	testtimeTime, err := time.Parse(time.RFC3339Nano, "2020-12-18T03:00:00.4770000Z")
	require.NoError(t, err)

	microsoftTodoData := []*project{
		{
			DisplayName: "Project 1",
			Tasks: []*task{
				{
					Title:  "Task 1",
					Status: "notStarted",
					Body: &body{
						Content:     "This is a description",
						ContentType: "text",
					},
				},
				{
					Title:             "Task 2",
					Status:            "completed",
					CompletedDateTime: testtime,
				},
				{
					Title:      "Task 3",
					Status:     "notStarted",
					Importance: "low",
				},
				{
					Title:      "Task 4",
					Status:     "notStarted",
					Importance: "high",
				},
				{
					Title:            "Task 5",
					Status:           "notStarted",
					IsReminderOn:     true,
					ReminderDateTime: testtime,
				},
				{
					Title:       "Task 6",
					Status:      "notStarted",
					DueDateTime: testtime,
				},
				{
					Title:       "Task 7",
					Status:      "notStarted",
					DueDateTime: testtime,
					Recurrence: &recurrence{
						Pattern: &pattern{
							// Every week
							Type:     "weekly",
							Interval: 1,
						},
					},
				},
			},
		},
		{
			DisplayName: "Project 2",
			Tasks: []*task{
				{
					Title:  "Task 1",
					Status: "notStarted",
				},
				{
					Title:  "Task 2",
					Status: "notStarted",
				},
			},
		},
	}

	expectedHierachie := []*models.ProjectWithTasksAndBuckets{
		{
			Project: models.Project{
				Title: "Migrated from Microsoft Todo",
				ID:    1,
			},
		},
		{
			Project: models.Project{
				ID:              2,
				ParentProjectID: 1,
				Title:           "Project 1",
			},
			Tasks: []*models.TaskWithComments{
				{
					Task: models.Task{
						Title:       "Task 1",
						Description: "This is a description",
					},
				},
				{
					Task: models.Task{
						Title:  "Task 2",
						Done:   true,
						DoneAt: testtimeTime,
					},
				},
				{
					Task: models.Task{
						Title:    "Task 3",
						Priority: 1,
					},
				},
				{
					Task: models.Task{
						Title:    "Task 4",
						Priority: 3,
					},
				},
				{
					Task: models.Task{
						Title: "Task 5",
						Reminders: []*models.TaskReminder{
							{
								Reminder: testtimeTime,
							},
						},
					},
				},
				{
					Task: models.Task{
						Title:   "Task 6",
						DueDate: testtimeTime,
					},
				},
				{
					Task: models.Task{
						Title:   "Task 7",
						DueDate: testtimeTime,
						Repeats: "FREQ=WEEKLY;INTERVAL=1",
					},
				},
			},
		},
		{
			Project: models.Project{
				Title:           "Project 2",
				ID:              3,
				ParentProjectID: 1,
			},
			Tasks: []*models.TaskWithComments{
				{
					Task: models.Task{
						Title: "Task 1",
					},
				},
				{
					Task: models.Task{
						Title: "Task 2",
					},
				},
			},
		},
	}

	hierachie, err := convertMicrosoftTodoData(microsoftTodoData)
	require.NoError(t, err)
	assert.NotNil(t, hierachie)
	if diff, equal := messagediff.PrettyDiff(hierachie, expectedHierachie); !equal {
		t.Errorf("converted microsoft todo data = %v, want %v, diff: %v", hierachie, expectedHierachie, diff)
	}
}
