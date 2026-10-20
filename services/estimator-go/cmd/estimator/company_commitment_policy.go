package main

import (
	"encoding/json"
	"strings"
	"time"
)

func validateCompanyReviewDecisions(review CompanyReview, request CompanyRequest) error {
	var analysis struct {
		Questions []string `json:"questions"`
		Conflicts []string `json:"conflicts"`
	}
	if len(request.Analysis) > 0 && json.Unmarshal(request.Analysis, &analysis) != nil {
		return workflowBad("Analyze this request again before confirming scope.")
	}
	questions := map[string]bool{}
	for _, question := range append(analysis.Questions, review.Questions...) {
		if strings.TrimSpace(question) != "" {
			questions[question] = true
		}
	}
	conflicts := map[string]bool{}
	for _, conflict := range analysis.Conflicts {
		if strings.TrimSpace(conflict) != "" {
			conflicts[conflict] = true
		}
	}
	for _, item := range []struct {
		items       map[string]bool
		resolutions map[string]CompanyQuestionResolution
		label       string
	}{{questions, review.QuestionResolutions, "question"}, {conflicts, review.ConflictResolutions, "conflict"}} {
		if len(item.resolutions) > 100 {
			return workflowBad("Too many review decisions.")
		}
		for key, resolution := range item.resolutions {
			if !item.items[key] || len(key) > 2000 || len(resolution.Resolution) > 2000 {
				return workflowBad("Review decisions must match the current questions and conflicts.")
			}
		}
		for key := range item.items {
			decision := item.resolutions[key]
			if !containsString([]string{"answered", "not_applicable"}, decision.Disposition) || len(strings.TrimSpace(decision.Resolution)) < 10 {
				return workflowBad("Resolve every original AI " + item.label + " with an answer or a reason it is not applicable before approving scope.")
			}
		}
	}
	return nil
}

func (store *recordStore) applyCompanyCommitment(c *WorkflowCompany, request *CompanyRequest, actor string, a companyAction, now time.Time) (string, error) {
	if len(request.Baselines) == 0 || !containsString([]string{"frozen", "tracking"}, request.Status) {
		return "", workflowBad("Commit a reviewed plan before scheduling or recording scope changes.")
	}
	baseline := request.Baselines[len(request.Baselines)-1]
	if a.BaselineID != baseline.ID {
		return "", workflowBad("This action must reference the current frozen baseline.")
	}
	switch a.Action {
	case "schedule.apply":
		plan := request.Schedule
		if plan == nil || plan.BaselineID != baseline.ID || plan.BaselineSHA256 != baseline.SHA256 {
			return "", workflowFailure{409, "Calculate a schedule for this commitment before applying dates."}
		}
		for _, resource := range plan.Input.Resources {
			found := false
			for _, member := range c.Members {
				if member.AccountID == resource.ID {
					found = true
				}
			}
			if !found {
				return "", workflowBad("A scheduled member left the company. Review availability and replan.")
			}
		}
		for _, work := range baseline.Review.WorkPackages {
			var planned *ScheduledTask
			for i := range plan.Tasks {
				if plan.Tasks[i].ID == work.ID {
					planned = &plan.Tasks[i]
				}
			}
			if planned == nil {
				return "", workflowBad("Recalculate the schedule to include each frozen task.")
			}
			index := -1
			for i := range request.Tracking {
				if request.Tracking[i].BaselineID == baseline.ID && request.Tracking[i].WorkPackageID == work.ID {
					index = i
				}
			}
			if index < 0 {
				request.Tracking = append(request.Tracking, CompanyTaskTracking{BaselineID: baseline.ID, WorkPackageID: work.ID, Status: "not_started"})
				index = len(request.Tracking) - 1
			}
			request.Tracking[index].AssigneeID = planned.AssigneeID
			request.Tracking[index].PlannedStart = planned.StartDate
			request.Tracking[index].TargetDate = planned.EndDate
			request.Tracking[index].UpdatedBy = actor
			request.Tracking[index].UpdatedAt = now
		}
	case "schedule.plan":
		for _, resource := range a.Schedule.Resources {
			found := false
			for _, member := range c.Members {
				if member.AccountID == resource.ID {
					found = true
				}
			}
			if !found {
				return "", workflowBad("Schedule resources must be current company members.")
			}
		}
		work := []ScheduleWork{}
		for _, item := range baseline.Review.WorkPackages {
			hours := 0.0
			found := item.Owner != "company"
			for _, task := range baseline.Estimate.Tasks {
				if task.Category == item.ID {
					hours = task.Hours
					found = true
				}
			}
			if !found {
				return "", workflowBad("The frozen work package has no matching effort record.")
			}
			work = append(work, ScheduleWork{ID: item.ID, Title: item.Title, Hours: hours, Owner: item.Owner})
		}
		plan, err := planDeliverySchedule(a.Schedule, work)
		if err != nil {
			return "", err
		}
		plan.BaselineID = baseline.ID
		plan.BaselineSHA256 = baseline.SHA256
		plan.PlannedBy = actor
		plan.PlannedAt = now
		request.Schedule = &plan
	case "scope_change.propose":
		change := a.ScopeChange
		if len(request.ScopeChanges) >= 100 || len(strings.TrimSpace(change.Description)) < 3 || len(change.Description) > 1000 || len(strings.TrimSpace(change.Reason)) < 3 || len(change.Reason) > 1000 || len(strings.TrimSpace(change.EffortImpact)) < 3 || len(change.EffortImpact) > 500 {
			return "", workflowBad("Provide a bounded change description, reason, and effort impact.")
		}
		change.ID, _ = newUUID()
		change.BaselineID = baseline.ID
		change.BaselineSHA256 = baseline.SHA256
		change.Status = "proposed"
		change.CreatedBy = actor
		change.CreatedAt = now
		change.ReviewedBy = ""
		change.ReviewedAt = nil
		change.ReviewNotes = ""
		request.ScopeChanges = append(request.ScopeChanges, change)
	case "scope_change.review":
		if !containsString([]string{"approved", "rejected"}, a.Decision) || len(strings.TrimSpace(a.Note)) < 10 || len(a.Note) > 2000 {
			return "", workflowBad("Choose approval or rejection and give a review reason.")
		}
		found := false
		for i := range request.ScopeChanges {
			change := &request.ScopeChanges[i]
			if change.ID != a.ChangeID {
				continue
			}
			found = true
			if change.Status != "proposed" || change.BaselineID != baseline.ID || change.BaselineSHA256 != baseline.SHA256 {
				return "", workflowFailure{409, "This scope change is no longer awaiting a decision for this baseline."}
			}
			change.Status = a.Decision
			change.ReviewedBy = actor
			change.ReviewedAt = &now
			change.ReviewNotes = strings.TrimSpace(a.Note)
		}
		if !found {
			return "", workflowBad("Scope change not found.")
		}
	}
	request.UpdatedAt = now
	return request.ID, nil
}
