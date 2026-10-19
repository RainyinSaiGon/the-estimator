package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (store *recordStore) applyCompanyAction(ctx context.Context, tx pgx.Tx, c *WorkflowCompany, role string, p recordPrincipal, a companyAction) (string, error) {
	admin := []string{"config", "member", "removeMember", "knowledge.add", "knowledge.approve", "knowledge.retire", "knowledge.refresh.failed", "gmail.configure", "gmail.tokens", "gmail.disconnect", "webhook.rotate", "knowledge.token.rotate", "knowledge.token.revoke"}
	if containsString(admin, a.Action) && role != "admin" {
		return "", workflowFailure{403, "Only a company administrator can perform this action."}
	}
	now := time.Now().UTC()
	switch a.Action {
	case "config":
		if err := validateCompanyConfig(a.Config); err != nil {
			return "", err
		}
		a.Config.Version = c.Config.Version + 1
		c.Config = a.Config
		c.ConfigHistory = append(c.ConfigHistory, a.Config)
		return c.ID, nil
	case "member", "removeMember":
		if !isUUID(a.AccountID) {
			return "", workflowBad("Enter the verified team member's account UUID.")
		}
		index := -1
		admins := 0
		for i, m := range c.Members {
			if m.Role == "admin" {
				admins++
			}
			if m.AccountID == a.AccountID {
				index = i
			}
		}
		if index >= 0 && c.Members[index].Role == "admin" && (a.Role != "admin" || a.Action == "removeMember") && admins <= 1 {
			return "", workflowBad("The last company administrator cannot be removed or demoted.")
		}
		key := store.ownerLookupKey(recordPrincipal{issuer: p.issuer, subject: a.AccountID})
		if a.Action == "removeMember" {
			if index >= 0 {
				c.Members = append(c.Members[:index], c.Members[index+1:]...)
			}
			_, err := tx.Exec(ctx, "DELETE FROM workflow_members WHERE company_id=$1 AND account_key=$2", c.ID, key)
			if c.Gmail.LinkedBy == a.AccountID {
				c.Gmail = CompanyConnector{Secrets: map[string]string{}}
			}
			if c.WebhookActor == a.AccountID {
				c.WebhookSecret = ""
				c.WebhookActor = ""
			}
			if c.KnowledgeTokenActor == a.AccountID {
				c.KnowledgeTokenHash = ""
				c.KnowledgeTokenActor = ""
			}
			return a.AccountID, err
		}
		if !workflowRole(a.Role, "admin", "reviewer", "member") {
			return "", workflowBad("Choose admin, reviewer, or member.")
		}
		m := CompanyMember{a.AccountID, a.Role}
		if a.Role != "admin" && c.Gmail.LinkedBy == a.AccountID {
			c.Gmail = CompanyConnector{Secrets: map[string]string{}}
		}
		if a.Role != "admin" && c.WebhookActor == a.AccountID {
			c.WebhookSecret = ""
			c.WebhookActor = ""
		}
		if a.Role != "admin" && c.KnowledgeTokenActor == a.AccountID {
			c.KnowledgeTokenHash = ""
			c.KnowledgeTokenActor = ""
		}
		if index >= 0 {
			c.Members[index] = m
		} else {
			c.Members = append(c.Members, m)
		}
		_, err := tx.Exec(ctx, "INSERT INTO workflow_members(company_id,account_key,role) VALUES($1,$2,$3) ON CONFLICT(company_id,account_key) DO UPDATE SET role=EXCLUDED.role", c.ID, key, a.Role)
		return a.AccountID, err
	case "knowledge.add":
		d := a.Document
		if len(c.Knowledge) >= 200 || len(d.Text) < 30 || len(d.Text) > 100000 || len(d.Title) < 2 || len(d.Title) > 200 {
			return "", workflowBad("Knowledge needs a title and 30–100,000 characters; up to 200 versions are supported.")
		}
		if d.URL != "" {
			u, err := url.Parse(d.URL)
			if err != nil || u.Scheme != "https" || !containsString(c.Config.ApprovedDomains, u.Hostname()) {
				return "", workflowBad("Knowledge URLs must use an approved HTTPS domain.")
			}
		}
		d.ID, _ = newUUID()
		d.Status = "draft"
		d.SHA256 = sha256Hex([]byte(d.Text))
		d.RetrievedAt = now
		d.ApprovedAt = nil
		d.ApprovedBy = ""
		if d.ReplacesID != "" {
			found := false
			for i := range c.Knowledge {
				if c.Knowledge[i].ID == d.ReplacesID && c.Knowledge[i].Status == "approved" && c.Knowledge[i].URL != "" {
					c.Knowledge[i].LastRefreshAttemptAt = &now
					c.Knowledge[i].LastRefreshError = ""
					found = true
				}
			}
			if !found {
				return "", workflowBad("The approved web source to refresh no longer exists.")
			}
		}
		c.Knowledge = append(c.Knowledge, d)
		return d.ID, nil
	case "knowledge.refresh.failed":
		found := false
		for i := range c.Knowledge {
			d := &c.Knowledge[i]
			if d.ID == a.DocumentID && d.Status == "approved" && d.URL != "" {
				d.LastRefreshAttemptAt = &now
				d.LastRefreshError = a.Error
				if len(d.LastRefreshError) > 300 {
					d.LastRefreshError = d.LastRefreshError[:300]
				}
				found = true
			}
		}
		if !found {
			return "", workflowBad("The approved web source to refresh no longer exists.")
		}
		return a.DocumentID, nil
	case "knowledge.approve", "knowledge.retire":
		for i := range c.Knowledge {
			d := &c.Knowledge[i]
			if d.ID == a.DocumentID {
				if a.Action == "knowledge.approve" {
					if d.URL != "" {
						u, err := url.Parse(d.URL)
						if err != nil || !containsString(c.Config.ApprovedDomains, u.Hostname()) {
							return "", workflowBad("This source domain is no longer approved.")
						}
					}
					d.Status = "approved"
					d.ApprovedBy = p.subject
					d.ApprovedAt = &now
					if d.ReplacesID != "" {
						for j := range c.Knowledge {
							if c.Knowledge[j].ID == d.ReplacesID {
								c.Knowledge[j].Status = "retired"
							}
						}
					}
				} else {
					d.Status = "retired"
				}
				return d.ID, nil
			}
		}
		return "", workflowBad("Knowledge version not found.")
	case "gmail.configure":
		if len(a.Secrets["clientId"]) < 8 || len(a.Secrets["clientSecret"]) < 8 || len(a.Secrets["clientSecret"]) > 2048 || len(a.Query) > 500 {
			return "", workflowBad("A Google OAuth client ID, secret, and bounded mailbox query are required.")
		}
		c.Gmail = CompanyConnector{Query: a.Query, Secrets: map[string]string{"clientId": a.Secrets["clientId"], "clientSecret": a.Secrets["clientSecret"]}, LinkedBy: p.subject}
		return c.ID, nil
	case "gmail.tokens":
		if c.Gmail.Secrets == nil {
			c.Gmail.Secrets = map[string]string{}
		}
		for k, v := range a.Secrets {
			if !containsString([]string{"accessToken", "refreshToken", "expiresAt", "historyId", "pageToken", "syncStartedAt"}, k) || len(v) > 4096 {
				return "", workflowBad("Invalid connector token.")
			}
			c.Gmail.Secrets[k] = v
		}
		if c.Gmail.Secrets["refreshToken"] == "" {
			return "", workflowBad("Google did not grant offline access. Reconnect with consent.")
		}
		c.Gmail.Connected = true
		c.Gmail.LinkedBy = p.subject
		c.Gmail.LastError = ""
		return c.ID, nil
	case "gmail.disconnect":
		c.Gmail = CompanyConnector{Secrets: map[string]string{}}
		return c.ID, nil
	case "gmail.claim":
		if role != "admin" || !c.Gmail.Connected {
			return "", workflowFailure{403, "An active administrator-owned connector is required."}
		}
		if c.Gmail.LeaseUntil != nil && c.Gmail.LeaseUntil.After(now) {
			return "", workflowFailure{409, "A mailbox sync is already running."}
		}
		until := now.Add(4 * time.Minute)
		c.Gmail.LeaseUntil = &until
		return c.ID, nil
	case "gmail.synced":
		if role != "admin" {
			return "", workflowFailure{403, "Administrator required."}
		}
		c.Gmail.LeaseUntil = nil
		c.Gmail.LastError = a.Error
		if a.Error == "" && a.Decision != "partial" {
			if !a.CompletedAt.IsZero() && a.CompletedAt.Before(now) {
				c.Gmail.LastSyncedAt = &a.CompletedAt
			} else {
				c.Gmail.LastSyncedAt = &now
			}
		}
		return c.ID, nil
	case "webhook.rotate":
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return "", err
		}
		c.WebhookSecret = base64.RawURLEncoding.EncodeToString(raw)
		c.WebhookActor = p.subject
		return c.ID, nil
	case "knowledge.token.rotate":
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return "", err
		}
		token := "wfk_" + base64.RawURLEncoding.EncodeToString(raw)
		c.KnowledgeTokenHash = sha256Hex([]byte(token))
		c.KnowledgeTokenActor = p.subject
		return token, nil
	case "knowledge.token.revoke":
		c.KnowledgeTokenHash = ""
		c.KnowledgeTokenActor = ""
		return c.ID, nil
	case "intake":
		if len(a.Title) < 3 || len(a.Title) > 200 || len(a.Text) > 100000 || len(a.Attachments) > 100 || len(a.ExternalID) > 500 || len(a.SourceIDs) > 100 {
			return "", workflowBad("Request title, text, or attachment limit exceeded.")
		}
		if !containsString([]string{"manual", "form", "gmail"}, a.Channel) {
			return "", workflowBad("Unknown intake channel.")
		}
		total := len(a.Text)
		for _, f := range a.Attachments {
			total += len(f.Text)
			if len(f.Text) > 40000 || len(f.Name) > 200 {
				return "", workflowBad("An attachment exceeds the extraction limit.")
			}
		}
		if (total < 30 && len(a.Attachments) == 0) || total > 200000 {
			return "", workflowBad("A request needs 30–200,000 extracted characters.")
		}
		if a.Channel != "manual" && a.ExternalID == "" {
			return "", workflowBad("External intake requires a stable source ID.")
		}
		for i := range c.Requests {
			existing := &c.Requests[i]
			if a.ExternalID != "" && existing.Channel == a.Channel && existing.ExternalID == a.ExternalID {
				if sameStringSet(existing.SourceIDs, a.SourceIDs) {
					return existing.ID, nil
				}
				if existing.Delivery != nil {
					continue
				}
				existing.Text = a.Text
				stored, err := store.persistCompanyAttachments(ctx, tx, c, existing.ID, a.Attachments)
				if err != nil {
					return "", err
				}
				a.Attachments = stored
				existing.Attachments = a.Attachments
				existing.SourceIDs = a.SourceIDs
				existing.Revision++
				existing.UpdatedAt = now
				existing.Status = "received"
				existing.CreatedBy = p.subject
				existing.AnalysisAttempts = 0
				existing.Analysis = nil
				existing.Estimate = nil
				existing.Review.Confirmed = false
				return existing.ID, nil
			}
		}
		if len(c.Requests) >= 200 {
			return "", workflowBad("Archive completed requests before adding more.")
		}
		id, _ := newUUID()
		stored, err := store.persistCompanyAttachments(ctx, tx, c, id, a.Attachments)
		if err != nil {
			return "", err
		}
		a.Attachments = stored
		status := "received"
		if total < 30 {
			status = "needs_attention"
		}
		c.Requests = append([]CompanyRequest{{ID: id, CreatedBy: p.subject, Title: a.Title, Channel: a.Channel, ExternalID: a.ExternalID, SourceIDs: a.SourceIDs, Text: a.Text, Attachments: a.Attachments, CreatedAt: now, UpdatedAt: now, Revision: 1, Status: status, Knowledge: []KnowledgePassage{}, Baselines: []CompanyBaseline{}}}, c.Requests...)
		return id, nil
	}
	var request *CompanyRequest
	for i := range c.Requests {
		if c.Requests[i].ID == a.RequestID {
			request = &c.Requests[i]
			break
		}
	}
	if request == nil {
		return "", workflowBad("Request not found.")
	}
	if a.ExpectedRevision > 0 && request.Revision != a.ExpectedRevision {
		return "", workflowFailure{409, "The source changed during analysis. Retry on the latest revision."}
	}
	if request.Delivery != nil && !containsString([]string{"delivery.review", "delivery.revise", "request.delete"}, a.Action) {
		return "", workflowBad("Delivered requests are immutable. Create a separate change request.")
	}
	switch a.Action {
	case "request.update":
		if len(a.Text) < 30 || len(a.Text) > 100000 || len(a.Title) < 3 || len(a.Title) > 200 {
			return "", workflowBad("Provide a title and 30–100,000 characters of source text.")
		}
		request.Title = a.Title
		request.Text = a.Text
		request.Revision++
		request.Review.Confirmed = false
		request.Estimate = nil
		request.Analysis = nil
		request.Status = "received"
		request.AnalysisAttempts = 0
		request.CreatedBy = p.subject
	case "analysis.retry":
		request.Status = "received"
		request.AnalysisAttempts = 0
		request.LastError = ""
		request.CreatedBy = p.subject
	case "request.delete":
		if role != "admin" {
			return "", workflowFailure{403, "Administrator required."}
		}
		if _, err := tx.Exec(ctx, "DELETE FROM workflow_attachments WHERE company_id=$1 AND request_id=$2", c.ID, request.ID); err != nil {
			return "", err
		}
		for i, v := range c.Requests {
			if v.ID == request.ID {
				c.Requests = append(c.Requests[:i], c.Requests[i+1:]...)
				break
			}
		}
		return a.RequestID, nil
	case "analysis.started":
		if a.Automatic && !companyAnalysisDue(*request, now) {
			return "", workflowFailure{409, "This request is no longer queued for automatic analysis."}
		}
		if request.Status == "analyzing" && request.UpdatedAt.After(now.Add(-5*time.Minute)) {
			return "", workflowFailure{409, "This request is already being analyzed."}
		}
		request.Status = "analyzing"
		request.CreatedBy = p.subject
		request.AnalysisAttempts++
		request.LastError = ""
	case "analysis.failed":
		request.Status = "failed"
		request.LastError = a.Error
		next := now.Add(time.Duration(request.AnalysisAttempts*request.AnalysisAttempts) * time.Minute)
		request.NextAttemptAt = &next
	case "analysis":
		if len(a.Analysis) == 0 || !json.Valid(a.Analysis) {
			return "", workflowBad("Structured analysis is required.")
		}
		request.Analysis = a.Analysis
		request.Knowledge = a.Knowledge
		request.Status = "needs_review"
		request.LastError = ""
		request.Review = a.Review
		request.Review.Confirmed = false
		request.Review.ConfirmedBy = ""
		request.Review.ConfirmedAt = nil
		request.Estimate = nil
	case "review":
		if err := validateCompanyReviewForRequest(c.Config, a.Review, *request); err != nil {
			return "", err
		}
		a.Review.ConfirmedBy = ""
		a.Review.ConfirmedAt = nil
		a.Review.ConfigVersion = c.Config.Version
		if a.Review.Confirmed && !a.Review.SourceLimitationsAccepted {
			for _, file := range request.Attachments {
				if file.Status != "extracted" || file.Truncated {
					return "", workflowBad("Acknowledge incomplete or failed document extraction before confirming scope.")
				}
			}
		}
		if a.Review.Confirmed {
			for _, passage := range request.Knowledge {
				approved := false
				for _, source := range c.Knowledge {
					if source.ID == passage.SourceID && source.Status == "approved" {
						approved = true
					}
				}
				if !approved {
					return "", workflowBad("Knowledge changed after analysis. Analyze again against the currently approved sources.")
				}
			}
		}
		if a.Review.Confirmed {
			a.Review.ConfirmedBy = p.subject
			a.Review.ConfirmedAt = &now
			request.Status = "reviewed"
		} else {
			request.Status = "needs_review"
		}
		request.Review = a.Review
		request.Estimate = nil
		request.Revision++
	case "estimate":
		if !currentRequestKnowledge(c, request) {
			return "", workflowBad("Knowledge changed after analysis. Analyze again before calculating effort.")
		}
		if !request.Review.Confirmed || request.Review.ConfigVersion != c.Config.Version {
			return "", workflowBad("Confirm the scope before calculating effort.")
		}
		estimate, err := estimateCompanyRequest(c, *request)
		if err != nil {
			return "", err
		}
		if a.StaffCount > 0 {
			if !finiteHours(a.StaffCount) || a.StaffCount > 1000 || !finiteHours(a.DependencyDays) {
				return "", workflowBad("Enter valid allocated staff and dependency delay assumptions.")
			}
			estimate.StaffCount = a.StaffCount
			estimate.DependencyDays = a.DependencyDays
			estimate.PlanningDays = estimate.Hours/(c.Config.HoursPerDay*a.StaffCount) + a.DependencyDays
			if a.StartDate != "" {
				start, parseErr := time.Parse("2006-01-02", a.StartDate)
				if parseErr != nil {
					return "", workflowBad("Choose a valid project start date.")
				}
				estimate.ProjectedDeliveryDate = projectedWorkdayDate(start, estimate.PlanningDays).Format("2006-01-02")
			}
		}
		request.Estimate = &estimate
		request.Status = "estimated"
	case "freeze":
		if !currentRequestKnowledge(c, request) {
			return "", workflowBad("Knowledge changed after analysis. Analyze again before freezing.")
		}
		if !request.Review.Confirmed || request.Estimate == nil || request.Estimate.ConfigVersion != c.Config.Version {
			return "", workflowBad("Review and recalculate using the current configuration before freezing.")
		}
		source := sourceText(*request)
		b := CompanyBaseline{SourceText: source, SourceSHA256: sha256Hex([]byte(source)), FrozenBy: p.subject, CreatedAt: now, EvaluationSplit: companySplit(request.ID), Review: request.Review, Estimate: *request.Estimate, Config: c.Config, Knowledge: request.Knowledge, Revision: request.Revision}
		b.ID, _ = newUUID()
		for _, t := range b.Estimate.Tasks {
			b.WorkPackageIDs = append(b.WorkPackageIDs, t.Category)
		}
		raw, _ := json.Marshal(b)
		b.SHA256 = sha256Hex(raw)
		frozenRaw, _ := json.Marshal(b)
		var frozen CompanyBaseline
		if err := json.Unmarshal(frozenRaw, &frozen); err != nil {
			return "", err
		}
		request.Baselines = append(request.Baselines, frozen)
		for _, work := range frozen.Review.WorkPackages {
			request.Tracking = append(request.Tracking, CompanyTaskTracking{
				BaselineID: frozen.ID, WorkPackageID: work.ID, Status: "not_started",
			})
		}
		request.Status = "frozen"
	case "tracking.update":
		if len(request.Baselines) == 0 || request.Status != "frozen" && request.Status != "tracking" {
			return "", workflowBad("Freeze a reviewed estimate before updating delivery tracking.")
		}
		baseline := request.Baselines[len(request.Baselines)-1]
		if a.BaselineID != baseline.ID {
			return "", workflowBad("Tracking can only be updated for the current frozen baseline.")
		}
		if !containsString([]string{"not_started", "in_progress", "blocked", "completed", "accepted"}, a.TrackingStatus) {
			return "", workflowBad("Choose a valid task progress status.")
		}
		var work *CompanyWorkPackage
		for i := range baseline.Review.WorkPackages {
			if baseline.Review.WorkPackages[i].ID == a.WorkPackageID {
				work = &baseline.Review.WorkPackages[i]
				break
			}
		}
		if work == nil {
			return "", workflowBad("The task is not part of the frozen baseline.")
		}
		if a.AssigneeID != "" {
			if work.Owner != "company" {
				return "", workflowBad("Only company-owned tasks can be assigned to a company member.")
			}
			memberFound := false
			for _, member := range c.Members {
				if member.AccountID == a.AssigneeID {
					memberFound = true
					break
				}
			}
			if !memberFound {
				return "", workflowBad("Choose a current company member for this task.")
			}
		}
		if len(a.Note) > 1000 || strings.ContainsRune(a.Note, '\x00') {
			return "", workflowBad("Task progress notes must be 1,000 characters or fewer.")
		}
		if !validWorkDate(a.PlannedStart) || !validWorkDate(a.TargetDate) {
			return "", workflowBad("Enter valid task dates in YYYY-MM-DD format.")
		}
		if a.PlannedStart != "" && a.TargetDate != "" && a.TargetDate < a.PlannedStart {
			return "", workflowBad("A task target date cannot be before its planned start date.")
		}
		updated := CompanyTaskTracking{
			BaselineID: baseline.ID, WorkPackageID: work.ID, Status: a.TrackingStatus,
			AssigneeID: a.AssigneeID, PlannedStart: a.PlannedStart, TargetDate: a.TargetDate,
			Note: strings.TrimSpace(a.Note), UpdatedAt: now, UpdatedBy: p.subject,
		}
		replaced := false
		for i := range request.Tracking {
			if request.Tracking[i].BaselineID == baseline.ID && request.Tracking[i].WorkPackageID == work.ID {
				request.Tracking[i] = updated
				replaced = true
				break
			}
		}
		if !replaced {
			request.Tracking = append(request.Tracking, updated)
		}
		request.Status = "tracking"
		request.UpdatedAt = now
		return request.ID + ":" + work.ID, nil
	case "delivery":
		var b *CompanyBaseline
		for i := range request.Baselines {
			if request.Baselines[i].ID == a.BaselineID {
				b = &request.Baselines[i]
			}
		}
		if b == nil || b.Revision != request.Revision {
			return "", workflowBad("Freeze the current reviewed scope before recording actuals.")
		}
		if a.CompletedAt.Before(b.CreatedAt) || a.CompletedAt.After(now.Add(24*time.Hour)) || !finiteHours(a.AdditionalScopeHours) || len(a.ActualHours) != len(b.WorkPackageIDs) {
			return "", workflowBad("Completion must follow the frozen baseline, and all original task actuals are required.")
		}
		for _, id := range b.WorkPackageIDs {
			n, ok := a.ActualHours[id]
			if !ok || !finiteHours(n) {
				return "", workflowBad("Actual hours must exactly match the frozen work packages.")
			}
		}
		reviewerOK := false
		for _, m := range c.Members {
			if m.AccountID == a.ReviewerID && workflowRole(m.Role, "admin", "reviewer") && m.AccountID != p.subject {
				reviewerOK = true
			}
		}
		if !reviewerOK {
			return "", workflowBad("Designate a different company reviewer or administrator.")
		}
		if !a.Synthetic && (!containsString([]string{"timesheet", "client-confirmed", "manual-reviewed"}, a.EvidenceSource) || len(strings.TrimSpace(a.EvidenceReference)) < 3) {
			return "", workflowBad("Recorded delivery requires a supported evidence source and reference.")
		}
		request.Delivery = &deliveryOutcome{BaselineID: b.ID, BaselineSHA256: b.SHA256, SubmittedBy: p.subject, ReviewerID: a.ReviewerID, CompletedAt: a.CompletedAt, ActualHours: a.ActualHours, AdditionalHours: a.AdditionalScopeHours, Synthetic: a.Synthetic, EvidenceSource: a.EvidenceSource, EvidenceReference: a.EvidenceReference, EvaluationSplit: b.EvaluationSplit, ReviewStatus: "pending", CalibrationReason: "Awaiting independent review.", ReviewDecisions: []lifecycleReviewDecision{}}
		request.Status = "delivery_review"
	case "delivery.review":
		d := request.Delivery
		if d == nil || d.ReviewStatus != "pending" || d.ReviewerID != p.subject || d.SubmittedBy == p.subject || !workflowRole(role, "admin", "reviewer") {
			return "", workflowFailure{403, "Only the assigned independent reviewer can decide this outcome."}
		}
		if !containsString([]string{"approved", "rejected"}, a.Decision) || len(strings.TrimSpace(a.Note)) < 3 {
			return "", workflowBad("Choose approve or reject and provide a review note.")
		}
		id, _ := newUUID()
		d.ReviewStatus = a.Decision
		d.ReviewDecisions = append(d.ReviewDecisions, lifecycleReviewDecision{ID: id, Kind: "delivery", At: now, ActorID: p.subject, Decision: a.Decision, Note: a.Note})
		d.CalibrationEligible, d.CalibrationReason = deliveryEligibility(*d)
		request.Status = "delivered"
	case "delivery.revise":
		if request.Delivery == nil || request.Delivery.ReviewStatus != "rejected" || request.Delivery.SubmittedBy != p.subject {
			return "", workflowFailure{403, "Only the submitter may correct rejected actuals."}
		}
		request.DeliveryHistory = append(request.DeliveryHistory, *request.Delivery)
		request.Delivery = nil
		request.Status = "frozen"
	default:
		return "", workflowBad("Unknown request action.")
	}
	request.UpdatedAt = now
	if tx != nil {
		_, err := tx.Exec(ctx, "UPDATE workflow_attachments SET expires_at=$1 WHERE company_id=$2 AND request_id=$3", now.Add(time.Duration(c.Config.RetentionDays)*24*time.Hour), c.ID, request.ID)
		if err != nil {
			return "", err
		}
	}
	return request.ID, nil
}
