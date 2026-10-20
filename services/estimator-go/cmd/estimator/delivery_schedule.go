package main

import (
	"math"
	"sort"
	"time"
)

type ScheduleResource struct {
	ID         string             `json:"id"`
	DailyHours float64            `json:"dailyHours"`
	Exceptions map[string]float64 `json:"exceptions"`
}
type ScheduleTaskInput struct {
	ID            string   `json:"id"`
	AssigneeID    string   `json:"assigneeId"`
	DependencyIDs []string `json:"dependencyIds"`
	NotBefore     string   `json:"notBefore"`
}
type DeliveryScheduleInput struct {
	StartDate       string              `json:"startDate"`
	WorkingWeekdays []int               `json:"workingWeekdays"`
	Holidays        []string            `json:"holidays"`
	Resources       []ScheduleResource  `json:"resources"`
	Tasks           []ScheduleTaskInput `json:"tasks"`
}
type ScheduleWork struct {
	ID    string
	Title string
	Hours float64
	Owner string
}
type ScheduledTask struct {
	ID          string  `json:"id"`
	AssigneeID  string  `json:"assigneeId"`
	StartDate   string  `json:"startDate"`
	EndDate     string  `json:"endDate"`
	EffortHours float64 `json:"effortHours"`
}
type DeliverySchedule struct {
	BaselineID     string                `json:"baselineId"`
	BaselineSHA256 string                `json:"baselineSha256"`
	PlannedAt      time.Time             `json:"plannedAt"`
	PlannedBy      string                `json:"plannedBy"`
	Input          DeliveryScheduleInput `json:"input"`
	Tasks          []ScheduledTask       `json:"tasks"`
	FinishDate     string                `json:"finishDate"`
}

// Plans use frozen effort and human-declared capacity. Dependencies are finish-to-start on the next day.
func planDeliverySchedule(input DeliveryScheduleInput, work []ScheduleWork) (DeliverySchedule, error) {
	result := DeliverySchedule{Input: input, Tasks: []ScheduledTask{}}
	start, err := time.Parse("2006-01-02", input.StartDate)
	if err != nil || len(input.StartDate) != 10 || len(input.WorkingWeekdays) == 0 || len(input.WorkingWeekdays) > 7 {
		return result, workflowBad("Choose a valid start date and working weekdays.")
	}
	weekdays := map[int]bool{}
	for _, day := range input.WorkingWeekdays {
		if day < 0 || day > 6 || weekdays[day] {
			return result, workflowBad("Working weekdays must be unique days from Sunday through Saturday.")
		}
		weekdays[day] = true
	}
	if len(work) == 0 || len(work) > 50 || len(input.Tasks) != len(work) || len(input.Resources) > 100 || len(input.Holidays) > 730 {
		return result, workflowBad("Include each frozen work package and bounded availability data.")
	}
	holidays := map[string]bool{}
	for _, date := range input.Holidays {
		if date == "" || !validWorkDate(date) {
			return result, workflowBad("Enter valid holiday dates.")
		}
		holidays[date] = true
	}
	resources := map[string]ScheduleResource{}
	for _, resource := range input.Resources {
		if _, duplicate := resources[resource.ID]; duplicate || resource.ID == "" || math.IsNaN(resource.DailyHours) || math.IsInf(resource.DailyHours, 0) || resource.DailyHours <= 0 || resource.DailyHours > 24 || len(resource.Exceptions) > 730 {
			return result, workflowBad("Each member needs unique, valid daily capacity.")
		}
		for date, hours := range resource.Exceptions {
			if date == "" || !validWorkDate(date) || math.IsNaN(hours) || math.IsInf(hours, 0) || hours < 0 || hours > 24 {
				return result, workflowBad("Date capacity overrides must contain valid dates and 0–24 available hours.")
			}
		}
		resources[resource.ID] = resource
	}
	workByID := map[string]ScheduleWork{}
	for _, item := range work {
		if _, exists := workByID[item.ID]; exists || item.ID == "" || !finiteHours(item.Hours) {
			return result, workflowBad("Schedule work must come from a valid frozen baseline.")
		}
		workByID[item.ID] = item
	}
	tasks := map[string]ScheduleTaskInput{}
	for _, task := range input.Tasks {
		source, exists := workByID[task.ID]
		if _, duplicate := tasks[task.ID]; duplicate || !exists || !validWorkDate(task.NotBefore) || len(task.DependencyIDs) > 50 {
			return result, workflowBad("Include each frozen work package exactly once with valid ready dates.")
		}
		seen := map[string]bool{}
		for _, id := range task.DependencyIDs {
			if _, found := workByID[id]; !found || id == task.ID || seen[id] {
				return result, workflowBad("Dependencies must reference unique other frozen tasks.")
			}
			seen[id] = true
		}
		if source.Owner == "company" {
			if _, found := resources[task.AssigneeID]; !found {
				return result, workflowBad("Assign every company task to an available member.")
			}
		} else if task.AssigneeID != "" || task.NotBefore == "" {
			return result, workflowBad("Provide a ready date for every external prerequisite and leave its member unassigned.")
		}
		tasks[task.ID] = task
	}
	used := map[string]float64{}
	scheduled := map[string]ScheduledTask{}
	pending := append([]ScheduleWork{}, work...)
	horizon := start.AddDate(0, 0, 730)
	for len(pending) > 0 {
		readyIndex := -1
		for index, item := range pending {
			ready := true
			for _, id := range tasks[item.ID].DependencyIDs {
				if _, done := scheduled[id]; !done {
					ready = false
				}
			}
			if ready {
				readyIndex = index
				break
			}
		}
		if readyIndex < 0 {
			return result, workflowBad("The task dependencies contain a cycle. Remove it before planning dates.")
		}
		source := pending[readyIndex]
		pending = append(pending[:readyIndex], pending[readyIndex+1:]...)
		task := tasks[source.ID]
		date := start
		if task.NotBefore != "" {
			bound, _ := time.Parse("2006-01-02", task.NotBefore)
			if bound.After(date) {
				date = bound
			}
		}
		for _, id := range task.DependencyIDs {
			bound, _ := time.Parse("2006-01-02", scheduled[id].EndDate)
			bound = bound.AddDate(0, 0, 1)
			if bound.After(date) {
				date = bound
			}
		}
		planned := ScheduledTask{ID: source.ID, AssigneeID: task.AssigneeID, EffortHours: 0}
		if source.Owner == "company" {
			resource := resources[task.AssigneeID]
			remaining := source.Hours
			planned.EffortHours = source.Hours
			for {
				if date.After(horizon) {
					return result, workflowBad("The declared capacity cannot finish this plan within two years. Review hours, staffing, and dependencies.")
				}
				day := date.Format("2006-01-02")
				key := resource.ID + ":" + day
				capacity := resource.DailyHours
				if override, found := resource.Exceptions[day]; found {
					capacity = override
				}
				if holidays[day] || !weekdays[int(date.Weekday())] {
					capacity = 0
				}
				available := math.Max(0, capacity-used[key])
				if available > 0 {
					if planned.StartDate == "" {
						planned.StartDate = day
					}
					allocated := math.Min(remaining, available)
					used[key] += allocated
					remaining -= allocated
					if remaining < .000001 {
						break
					}
				}
				date = date.AddDate(0, 0, 1)
			}
		} else {
			if date.After(horizon) {
				return result, workflowBad("External ready dates must fall within two years of the plan start.")
			}
			planned.StartDate = date.Format("2006-01-02")
		}
		planned.EndDate = date.Format("2006-01-02")
		scheduled[source.ID] = planned
	}
	ends := []string{}
	for _, item := range work {
		result.Tasks = append(result.Tasks, scheduled[item.ID])
		ends = append(ends, scheduled[item.ID].EndDate)
	}
	sort.Strings(ends)
	result.FinishDate = ends[len(ends)-1]
	return result, nil
}
