package main

import (
	"encoding/json"
	"testing"
	"time"
)

func scheduleFixture() (DeliveryScheduleInput, []ScheduleWork) {
	return DeliveryScheduleInput{StartDate: "2026-10-23", WorkingWeekdays: []int{1, 2, 3, 4, 5}, Holidays: []string{"2026-10-26"}, Resources: []ScheduleResource{{ID: "alice", DailyHours: 6, Exceptions: map[string]float64{"2026-10-23": 2}}, {ID: "bob", DailyHours: 6}}, Tasks: []ScheduleTaskInput{{ID: "a", AssigneeID: "alice"}, {ID: "b", AssigneeID: "alice"}, {ID: "c", AssigneeID: "bob", DependencyIDs: []string{"a"}}}}, []ScheduleWork{{ID: "a", Hours: 8, Owner: "company"}, {ID: "b", Hours: 6, Owner: "company"}, {ID: "c", Hours: 6, Owner: "company"}}
}
func TestDeliveryScheduleCapacityAndDependencies(t *testing.T) {
	input, work := scheduleFixture()
	plan, err := planDeliverySchedule(input, work)
	if err != nil {
		t.Fatal(err)
	}
	if plan.FinishDate != "2026-10-28" || plan.Tasks[0].StartDate != "2026-10-23" || plan.Tasks[0].EndDate != "2026-10-27" || plan.Tasks[1].StartDate != "2026-10-28" || plan.Tasks[2].StartDate != "2026-10-28" {
		t.Fatalf("wrong capacity/dependency dates: %+v", plan)
	}
	input.Tasks[0].DependencyIDs = []string{"c"}
	if _, err = planDeliverySchedule(input, work); err == nil {
		t.Fatal("accepted a dependency cycle")
	}
	input, _ = scheduleFixture()
	input.Resources[0].DailyHours = 0
	if _, err = planDeliverySchedule(input, work); err == nil {
		t.Fatal("accepted zero capacity")
	}
	input, _ = scheduleFixture()
	input.Resources[0].Exceptions = map[string]float64{"2026-02-30": 2}
	if _, err = planDeliverySchedule(input, work); err == nil {
		t.Fatal("accepted impossible date")
	}
}
func TestOriginalQuestionsAndConflictsCannotBeRemovedToBypassReview(t *testing.T) {
	request := CompanyRequest{Analysis: json.RawMessage(`{"questions":["Which API?"],"conflicts":["Two different launch dates"]}`)}
	review := CompanyReview{Questions: []string{}}
	if err := validateCompanyReviewDecisions(review, request); err == nil {
		t.Fatal("deleting original questions bypassed review")
	}
	review.QuestionResolutions = map[string]CompanyQuestionResolution{"Which API?": {Disposition: "answered", Resolution: "Use the documented customer API."}}
	if err := validateCompanyReviewDecisions(review, request); err == nil {
		t.Fatal("unresolved conflict bypassed review")
	}
	review.ConflictResolutions = map[string]CompanyQuestionResolution{"Two different launch dates": {Disposition: "answered", Resolution: "Customer confirmed the later launch date."}}
	if err := validateCompanyReviewDecisions(review, request); err != nil {
		t.Fatal(err)
	}
}
func TestScopeChangeDecisionsRetainTheFrozenBaseline(t *testing.T) {
	c := workflowFixture()
	c.Requests = []CompanyRequest{{ID: companyOther, Status: "frozen", Revision: 1, Baselines: []CompanyBaseline{{ID: companyOther, SHA256: "frozen-digest", Revision: 1}}}}
	proposal := companyAction{Action: "scope_change.propose", RequestID: companyOther, BaselineID: companyOther, ScopeChange: CompanyScopeChange{Description: "Add incremental sync", Reason: "Separate customer request", EffortImpact: "Estimate independently after approval"}}
	if err := applyTestAction(t, &c, companyOwner, "reviewer", proposal); err == nil {
		t.Fatal("reviewer changed scope")
	}
	if err := applyTestAction(t, &c, companyOwner, "admin", proposal); err != nil {
		t.Fatal(err)
	}
	change := c.Requests[0].ScopeChanges[0]
	decision := companyAction{Action: "scope_change.review", RequestID: companyOther, BaselineID: companyOther, ChangeID: change.ID, Decision: "approved", Note: "Reviewed the additional requested work separately."}
	if err := applyTestAction(t, &c, companyOwner, "admin", decision); err != nil {
		t.Fatal(err)
	}
	if c.Requests[0].Baselines[0].SHA256 != "frozen-digest" || c.Requests[0].ScopeChanges[0].ReviewedBy != companyOwner || c.Requests[0].ScopeChanges[0].ReviewedAt.Before(time.Now().Add(-time.Minute)) {
		t.Fatal("decision changed baseline or lost provenance")
	}
	if err := applyTestAction(t, &c, companyOwner, "admin", decision); err == nil {
		t.Fatal("overwrote an existing decision")
	}
}

func TestApplyingSchedulePreservesTrackingAndBaseline(t *testing.T) {
	c := workflowFixture()
	c.Requests = []CompanyRequest{{ID: companyOther, Status: "frozen", Baselines: []CompanyBaseline{{ID: companyOther, SHA256: "frozen-digest", Review: CompanyReview{WorkPackages: []CompanyWorkPackage{{ID: "work", Owner: "company"}}}, Estimate: CompanyEstimate{Tasks: []CompanyEstimateTask{{Category: "work", Hours: 8}}}}}, Tracking: []CompanyTaskTracking{{BaselineID: companyOther, WorkPackageID: "work", Status: "in_progress", Note: "Work started", Milestones: []CompanyTaskMilestone{{ID: companyOwner, Title: "Acceptance review", Status: "pending"}}}}}}
	input := DeliveryScheduleInput{StartDate: "2026-10-23", WorkingWeekdays: []int{1, 2, 3, 4, 5}, Resources: []ScheduleResource{{ID: companyOwner, DailyHours: 6}}, Tasks: []ScheduleTaskInput{{ID: "work", AssigneeID: companyOwner}}}
	if err := applyTestAction(t, &c, companyOwner, "admin", companyAction{Action: "schedule.plan", RequestID: companyOther, BaselineID: companyOther, Schedule: input}); err != nil {
		t.Fatal(err)
	}
	if err := applyTestAction(t, &c, companyOwner, "admin", companyAction{Action: "schedule.apply", RequestID: companyOther, BaselineID: companyOther}); err != nil {
		t.Fatal(err)
	}
	tracked := c.Requests[0].Tracking[0]
	if tracked.TargetDate != "2026-10-26" || tracked.Status != "in_progress" || tracked.Note != "Work started" || len(tracked.Milestones) != 1 || c.Requests[0].Baselines[0].SHA256 != "frozen-digest" {
		t.Fatalf("schedule application lost tracking or changed the baseline: %+v", tracked)
	}
}
