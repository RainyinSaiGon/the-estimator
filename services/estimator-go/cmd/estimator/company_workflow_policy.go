package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
)

func (e workflowFailure) Error() string { return e.message }
func companyView(c *WorkflowCompany) *WorkflowCompany {
	raw, _ := json.Marshal(c)
	var view WorkflowCompany
	_ = json.Unmarshal(raw, &view)
	view.Gmail.Secrets = nil
	view.WebhookSecret = ""
	view.WebhookActor = ""
	view.KnowledgeTokenHash = ""
	view.KnowledgeTokenActor = ""
	return &view
}
func sourceText(r CompanyRequest) string {
	parts := []string{r.Text}
	for _, a := range r.Attachments {
		if a.Text != "" {
			parts = append(parts, "[Attachment: "+a.Name+"]\n"+a.Text)
		}
	}
	return strings.Join(parts, "\n\n")
}
func companyAnalysisDue(request CompanyRequest, now time.Time) bool {
	return request.Delivery == nil && (request.Status == "received" ||
		request.Status == "analyzing" && request.UpdatedAt.Before(now.Add(-5*time.Minute)) ||
		request.Status == "failed" && request.AnalysisAttempts < 3 && request.NextAttemptAt != nil && !request.NextAttemptAt.After(now))
}
func pruneCompany(c *WorkflowCompany, now time.Time) {
	kept := make([]CompanyRequest, 0, len(c.Requests))
	for _, r := range c.Requests {
		if r.UpdatedAt.Add(time.Duration(c.Config.RetentionDays) * 24 * time.Hour).After(now) {
			kept = append(kept, r)
		}
	}
	c.Requests = kept
}
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]bool{}
	for _, v := range a {
		m[v] = true
	}
	for _, v := range b {
		if !m[v] {
			return false
		}
	}
	return true
}
func validateCompanyReview(config CompanyConfig, r CompanyReview) error {
	return validateCompanyReviewForRequest(config, r, CompanyRequest{})
}
func validateCompanyReviewForRequest(config CompanyConfig, r CompanyReview, request CompanyRequest) error {
	if !containsString(requestTypes(), r.RequestType) {
		return workflowBad("Choose a request classification.")
	}
	if r.ProductID != "" {
		found := false
		for _, p := range config.Products {
			if p.ID == r.ProductID {
				found = true
			}
		}
		if !found {
			return workflowBad("Select a configured product, or leave product fit unconfirmed.")
		}
	}
	if len(r.WorkPackages) > 50 || len(r.Questions) > 50 || len(r.Deliverables) > 5000 || len(r.Acceptance) > 5000 {
		return workflowBad("Reviewed scope exceeds limits.")
	}
	knownFields := map[string]bool{}
	for _, field := range config.Fields {
		knownFields[field.Key] = true
	}
	for key := range r.Fields {
		if !knownFields[key] {
			return workflowBad("The review includes an unconfigured intake field: " + key)
		}
	}
	for _, f := range config.Fields {
		required := f.Required
		if len(f.RequestTypes) > 0 && !containsString(f.RequestTypes, r.RequestType) {
			required = false
		}
		for key, expected := range f.RequiredWhen {
			if fmt.Sprint(r.Fields[key]) != expected {
				required = false
			}
		}
		value, exists := r.Fields[f.Key]
		missing := !exists || value == nil || strings.TrimSpace(fmt.Sprint(value)) == ""
		if r.Confirmed && required && missing {
			return workflowBad("Required field needs confirmation: " + f.Label)
		}
		if missing {
			continue
		}
		switch f.Type {
		case "number":
			if n, ok := value.(float64); !ok || !finiteHours(n) {
				return workflowBad("Expected a non-negative number: " + f.Label)
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				return workflowBad("Expected true or false: " + f.Label)
			}
		case "enum":
			if s, ok := value.(string); !ok || !containsString(f.Options, s) {
				return workflowBad("Choose an allowed value: " + f.Label)
			}
		default:
			if s, ok := value.(string); !ok || len(s) > 5000 {
				return workflowBad("Expected bounded text: " + f.Label)
			}
		}
	}
	seen := map[string]bool{}
	for _, w := range r.WorkPackages {
		if w.ID == "" || len(w.ID) > 80 || seen[w.ID] || w.Title == "" || !finiteHours(w.Quantity) || w.Quantity <= 0 || !containsString([]string{"company", "customer", "vendor"}, w.Owner) {
			return workflowBad("Work packages need unique IDs, title, positive quantity, and an owner.")
		}
		seen[w.ID] = true
		found := false
		for _, t := range config.Tasks {
			if t.ID == w.TaskID && (len(t.RequestTypes) == 0 || containsString(t.RequestTypes, r.RequestType)) {
				found = true
			}
		}
		if !found {
			return workflowBad("Choose a configured task suitable for this request type.")
		}
		if r.Confirmed && strings.TrimSpace(w.Acceptance) == "" {
			return workflowBad("Define completion criteria for every work package.")
		}
		if w.Basis != "" && w.Basis != "source" && w.Basis != "inference" {
			return workflowBad("Choose whether each task is source-based or an inference.")
		}
		if w.Basis == "source" {
			verified := false
			if w.SourceName == "Message" && w.Evidence != "" && strings.Contains(request.Text, w.Evidence) {
				verified = true
			}
			for i, attachment := range request.Attachments {
				if w.SourceName == fmt.Sprintf("%d: %s", i+1, attachment.Name) && w.Evidence != "" && strings.Contains(attachment.Text, w.Evidence) {
					verified = true
				}
			}
			if !verified {
				return workflowBad("Task evidence must quote the matching original message or attachment.")
			}
		} else if w.Basis == "inference" && (w.SourceName != "" || w.Evidence != "") {
			return workflowBad("Inferred tasks cannot claim a source quotation.")
		}
	}
	if r.Confirmed && (strings.TrimSpace(r.Deliverables) == "" || strings.TrimSpace(r.Acceptance) == "") {
		return workflowBad("Confirm deliverables and acceptance criteria before approving scope.")
	}
	if r.Confirmed {
		if err := validateCompanyReviewDecisions(r, request); err != nil {
			return err
		}
	}
	return nil
}
func companySplit(id string) string {
	digest := sha256.Sum256([]byte("the-estimator-delivery-holdout-v1:" + id))
	if digest[0]%5 == 0 {
		return "holdout"
	}
	return "training"
}
func currentRequestKnowledge(c *WorkflowCompany, r *CompanyRequest) bool {
	for _, passage := range r.Knowledge {
		active := false
		for _, source := range c.Knowledge {
			if source.ID == passage.SourceID && source.Status == "approved" && source.SHA256 == passage.SHA256 {
				active = true
				break
			}
		}
		if !active {
			return false
		}
	}
	return true
}
func estimateCompanyRequest(c *WorkflowCompany, r CompanyRequest) (CompanyEstimate, error) {
	if len(r.Review.WorkPackages) == 0 {
		return CompanyEstimate{}, workflowBad("This request is not yet estimable. Define work packages after clarification.")
	}
	result := CompanyEstimate{ConfigVersion: c.Config.Version, EngineVersion: "company-workflow/1", Tasks: []CompanyEstimateTask{}, Limitation: "Configured planning priors. Sparse or unrepresentative history does not establish accuracy. Calendar duration requires confirmed staffing and dependency dates."}
	for _, w := range r.Review.WorkPackages {
		if w.Owner != "company" {
			continue
		}
		var template *CompanyTask
		for i := range c.Config.Tasks {
			if c.Config.Tasks[i].ID == w.TaskID {
				template = &c.Config.Tasks[i]
			}
		}
		if template == nil {
			return result, workflowBad("A configured task has been removed. Review the scope again.")
		}
		ratios := []float64{}
		references := []string{}
		for _, past := range c.Requests {
			d := past.Delivery
			if past.ID == r.ID || d == nil || d.Synthetic || !d.CalibrationEligible || d.EvaluationSplit != "training" || d.ReviewStatus != "approved" {
				continue
			}
			for _, b := range past.Baselines {
				if b.ID != d.BaselineID || b.Review.RequestType != r.Review.RequestType || b.Review.ProductID != r.Review.ProductID {
					continue
				}
				for _, task := range b.Estimate.Tasks {
					if task.TemplateID == w.TaskID && task.Base > 0 {
						if actual, ok := d.ActualHours[task.Category]; ok {
							ratio := math.Max(.35, math.Min(3, actual/task.Base))
							ratios = append(ratios, ratio)
							references = append(references, past.ID)
						}
					}
				}
			}
		}
		factor := 1.0
		n := len(ratios)
		if n > 0 {
			sort.Float64s(ratios)
			median := ratios[n/2]
			if n%2 == 0 {
				median = (ratios[n/2-1] + median) / 2
			}
			factor = 1 + float64(n)/float64(n+4)*(median-1)
		}
		base := template.BaseHours * w.Quantity
		hours := base * factor
		result.Tasks = append(result.Tasks, CompanyEstimateTask{Category: w.ID, TemplateID: w.TaskID, Label: w.Title, Base: base, Factor: factor, Hours: hours, Low: hours * template.LowFactor, High: hours * template.HighFactor, Observations: n, ReferenceIDs: references})
		result.BaseHours += base
		result.Hours += hours
		result.Low += hours * template.LowFactor
		result.High += hours * template.HighFactor
	}
	if len(result.Tasks) == 0 {
		return result, workflowBad("No company-owned work packages are available to estimate.")
	}
	if !finiteHours(result.High) {
		return result, workflowBad("The resulting estimate exceeds the supported effort limit. Review task quantities.")
	}
	return result, nil
}
func projectedWorkdayDate(start time.Time, workingDays float64) time.Time {
	date := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for date.Weekday() == time.Saturday || date.Weekday() == time.Sunday {
		date = date.AddDate(0, 0, 1)
	}
	remaining := int(math.Ceil(workingDays))
	if remaining > 0 {
		remaining--
	}
	for remaining > 0 {
		date = date.AddDate(0, 0, 1)
		if date.Weekday() != time.Saturday && date.Weekday() != time.Sunday {
			remaining--
		}
	}
	return date
}
func validWorkDate(value string) bool {
	if value == "" {
		return true
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}
func searchCompanyKnowledge(c *WorkflowCompany, query string) []KnowledgePassage {
	tokens := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	unique := map[string]bool{}
	stop := map[string]bool{"the": true, "and": true, "for": true, "with": true, "from": true, "this": true, "that": true, "have": true, "our": true, "please": true, "request": true, "need": true, "would": true, "will": true}
	for _, t := range tokens {
		if len(t) > 2 && !stop[t] {
			unique[t] = true
		}
	}
	found := []KnowledgePassage{}
	for _, d := range c.Knowledge {
		if d.Status != "approved" {
			continue
		}
		chunks := knowledgeChunks(d.Text)
		for _, chunk := range chunks {
			chunk = strings.TrimSpace(chunk)
			if len(chunk) < 20 {
				continue
			}
			score := 0
			lower := strings.ToLower(d.Title + " " + chunk)
			for t := range unique {
				if strings.Contains(lower, t) {
					score++
				}
			}
			if score > 0 {
				found = append(found, KnowledgePassage{SourceID: d.ID, Title: d.Title, URL: d.URL, Passage: chunk, RetrievedAt: d.RetrievedAt, SHA256: d.SHA256, Score: score})
			}
		}
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].Score > found[j].Score })
	if len(found) > 12 {
		found = found[:12]
	}
	return found
}

// Overlapping rune windows preserve evidence in long paragraphs and keep UTF-8
// intact. Quotes remain exact substrings of the approved source snapshot.
// Overlapping rune windows preserve evidence in long paragraphs and keep UTF-8
// intact. Quotes remain exact substrings of the approved source snapshot.
func knowledgeChunks(value string) []string {
	runes := []rune(value)
	chunks := []string{}
	for start := 0; start < len(runes); start += 2000 {
		end := start + 2500
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
		if end == len(runes) {
			break
		}
	}
	return chunks
}
func companyIntakeSchema(c CompanyConfig) map[string]any {
	properties := map[string]any{}
	required := []string{}
	rules := []any{}
	for _, f := range c.Fields {
		kind := f.Type
		if kind == "enum" {
			kind = "string"
		}
		p := map[string]any{"type": kind, "title": f.Label}
		if f.Type == "enum" {
			p["enum"] = f.Options
		}
		properties[f.Key] = p
		if f.Required && len(f.RequestTypes) == 0 && len(f.RequiredWhen) == 0 {
			required = append(required, f.Key)
		}
		if f.Required && (len(f.RequestTypes) > 0 || len(f.RequiredWhen) > 0) {
			conditions := map[string]any{}
			keys := []string{}
			for k, v := range f.RequiredWhen {
				conditions[k] = map[string]any{"const": v}
				keys = append(keys, k)
			}
			if len(f.RequestTypes) > 0 {
				conditions["requestType"] = map[string]any{"enum": f.RequestTypes}
				keys = append(keys, "requestType")
			}
			rules = append(rules, map[string]any{"if": map[string]any{"properties": conditions, "required": keys}, "then": map[string]any{"required": []string{f.Key}}})
		}
	}
	properties["requestType"] = map[string]any{"type": "string", "enum": requestTypes()}
	return map[string]any{"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "properties": properties, "required": required, "allOf": rules, "additionalProperties": false}
}
func companyEvaluationRows(c *WorkflowCompany) []map[string]any {
	rows := []map[string]any{}
	for _, r := range c.Requests {
		if r.Delivery == nil {
			continue
		}
		for _, b := range r.Baselines {
			if b.ID == r.Delivery.BaselineID {
				rows = append(rows, map[string]any{"id": r.ID, "payload": map[string]any{"baseline": b, "estimate": b.Estimate, "reviewedScope": map[string]string{"domain": b.Review.RequestType}, "deliveryOutcome": r.Delivery}})
			}
		}
	}
	return rows
}
func evaluateCompany(c *WorkflowCompany) map[string]any {
	type cohort struct {
		Count    int            `json:"count"`
		Base     float64        `json:"baseAbsoluteErrorSum"`
		Adjusted float64        `json:"adjustedAbsoluteErrorSum"`
		Bias     float64        `json:"signedBiasSum"`
		Covered  int            `json:"covered"`
		Domains  map[string]int `json:"domains"`
		Limit    string         `json:"sampleLimit"`
	}
	groups := map[string]*cohort{}
	excluded := map[string]int{}
	for _, r := range c.Requests {
		d := r.Delivery
		if d == nil {
			excluded["missing_delivery"]++
			continue
		}
		if d.ReviewStatus != "approved" {
			excluded["unapproved_delivery"]++
			continue
		}
		if d.EvaluationSplit != "holdout" {
			excluded["training"]++
			continue
		}
		if !d.Synthetic && !d.CalibrationEligible {
			excluded["ineligible_recorded"]++
			continue
		}
		var b *CompanyBaseline
		for i := range r.Baselines {
			if r.Baselines[i].ID == d.BaselineID {
				b = &r.Baselines[i]
			}
		}
		if b == nil {
			continue
		}
		key := "recorded"
		if d.Synthetic {
			key = "synthetic"
		}
		g := groups[key]
		if g == nil {
			g = &cohort{Domains: map[string]int{}}
			groups[key] = g
		}
		actual := 0.0
		for _, v := range d.ActualHours {
			actual += v
		}
		g.Count++
		g.Base += math.Abs(b.Estimate.BaseHours - actual)
		g.Adjusted += math.Abs(b.Estimate.Hours - actual)
		g.Bias += b.Estimate.Hours - actual
		if actual >= b.Estimate.Low && actual <= b.Estimate.High {
			g.Covered++
		}
		g.Domains[b.Review.RequestType]++
	}
	for _, g := range groups {
		g.Limit = "Descriptive only; representativeness must be reviewed."
		if g.Count < 30 {
			g.Limit = "Too small for a conclusion."
		}
	}
	status := "no_eligible_holdout"
	if len(groups) > 0 {
		status = "measured"
	}
	return map[string]any{"status": status, "holdout": groups, "excluded": excluded, "limitations": []string{"Added scope is excluded.", "Holdout outcomes never train the adjustment.", "Synthetic outcomes are reported separately.", "Sample size alone does not establish representativeness."}}
}
func verifyWebhook(secret, timestamp, signature string, body []byte, now time.Time) bool {
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil || math.Abs(now.Sub(parsed).Seconds()) > 300 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = io.WriteString(mac, timestamp+".")
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return secret != "" && hmac.Equal([]byte(expected), []byte(signature))
}
