package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/003_companies.sql
var companySchema string

type IntakeField struct {
	Priority     string            `json:"priority"`
	Question     string            `json:"question"`
	Key          string            `json:"key"`
	Label        string            `json:"label"`
	Type         string            `json:"type"`
	Required     bool              `json:"required"`
	RequestTypes []string          `json:"requestTypes"`
	Options      []string          `json:"options"`
	RequiredWhen map[string]string `json:"requiredWhen"`
}
type CompanyProduct struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
type CompanyTask struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	RequestTypes []string `json:"requestTypes"`
	BaseHours    float64  `json:"baseHours"`
	LowFactor    float64  `json:"lowFactor"`
	HighFactor   float64  `json:"highFactor"`
}
type CompanyConfig struct {
	Version         int              `json:"version"`
	Fields          []IntakeField    `json:"fields"`
	Products        []CompanyProduct `json:"products"`
	Tasks           []CompanyTask    `json:"tasks"`
	Capabilities    []string         `json:"capabilities"`
	ApprovedDomains []string         `json:"approvedDomains"`
	RetentionDays   int              `json:"retentionDays"`
	HoursPerDay     float64          `json:"hoursPerDay"`
}
type CompanyMember struct {
	AccountID string `json:"accountId"`
	Role      string `json:"role"`
}
type CompanyAudit struct {
	At       time.Time `json:"at"`
	Actor    string    `json:"actor"`
	Action   string    `json:"action"`
	ObjectID string    `json:"objectId"`
}
type CompanyAttachment struct {
	ContentBase64 string   `json:"contentBase64,omitempty"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Type          string   `json:"type"`
	Text          string   `json:"text"`
	SHA256        string   `json:"sha256"`
	Status        string   `json:"status"`
	Error         string   `json:"error,omitempty"`
	Truncated     bool     `json:"truncated"`
	Locators      []string `json:"locators"`
}
type KnowledgeDocument struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	URL         string     `json:"url"`
	Text        string     `json:"text"`
	SHA256      string     `json:"sha256"`
	Status      string     `json:"status"`
	RetrievedAt time.Time  `json:"retrievedAt"`
	ApprovedAt  *time.Time `json:"approvedAt,omitempty"`
	ApprovedBy  string     `json:"approvedBy,omitempty"`
	ReplacesID  string     `json:"replacesId,omitempty"`
}
type KnowledgePassage struct {
	SourceID    string    `json:"sourceId"`
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Passage     string    `json:"passage"`
	RetrievedAt time.Time `json:"retrievedAt"`
	SHA256      string    `json:"sha256"`
	Score       int       `json:"score"`
}
type CompanyWorkPackage struct {
	ID           string  `json:"id"`
	TaskID       string  `json:"taskId"`
	Title        string  `json:"title"`
	Quantity     float64 `json:"quantity"`
	Owner        string  `json:"owner"`
	Acceptance   string  `json:"acceptance"`
	Dependencies string  `json:"dependencies"`
}
type CompanyReview struct {
	ConfigVersion             int                  `json:"configVersion"`
	SourceLimitationsAccepted bool                 `json:"sourceLimitationsAccepted"`
	RequestType               string               `json:"requestType"`
	ProductID                 string               `json:"productId"`
	Fields                    map[string]any       `json:"fields"`
	Deliverables              string               `json:"deliverables"`
	Exclusions                string               `json:"exclusions"`
	Acceptance                string               `json:"acceptance"`
	Dependencies              string               `json:"dependencies"`
	Questions                 []string             `json:"questions"`
	WorkPackages              []CompanyWorkPackage `json:"workPackages"`
	Confirmed                 bool                 `json:"confirmed"`
	ConfirmedBy               string               `json:"confirmedBy"`
	ConfirmedAt               *time.Time           `json:"confirmedAt,omitempty"`
}
type CompanyEstimateTask struct {
	Category     string   `json:"category"`
	TemplateID   string   `json:"templateId"`
	Label        string   `json:"label"`
	Base         float64  `json:"base"`
	Factor       float64  `json:"factor"`
	Hours        float64  `json:"hours"`
	Low          float64  `json:"low"`
	High         float64  `json:"high"`
	Observations int      `json:"observations"`
	ReferenceIDs []string `json:"referenceIds"`
}
type CompanyEstimate struct {
	PlanningDays   float64               `json:"planningDays,omitempty"`
	StaffCount     float64               `json:"staffCount,omitempty"`
	DependencyDays float64               `json:"dependencyDays,omitempty"`
	Hours          float64               `json:"hours"`
	BaseHours      float64               `json:"baseHours"`
	Low            float64               `json:"low"`
	High           float64               `json:"high"`
	Tasks          []CompanyEstimateTask `json:"tasks"`
	ConfigVersion  int                   `json:"configVersion"`
	EngineVersion  string                `json:"engineVersion"`
	Limitation     string                `json:"limitation"`
}
type CompanyBaseline struct {
	SourceText      string             `json:"sourceText"`
	SourceSHA256    string             `json:"sourceSha256"`
	FrozenBy        string             `json:"frozenBy"`
	ID              string             `json:"id"`
	CreatedAt       time.Time          `json:"createdAt"`
	SHA256          string             `json:"sha256"`
	EvaluationSplit string             `json:"evaluationSplit"`
	WorkPackageIDs  []string           `json:"workPackageIds"`
	Review          CompanyReview      `json:"review"`
	Estimate        CompanyEstimate    `json:"estimate"`
	Config          CompanyConfig      `json:"config"`
	Knowledge       []KnowledgePassage `json:"knowledge"`
	Revision        int                `json:"revision"`
}
type CompanyRequest struct {
	CreatedBy        string              `json:"createdBy"`
	AnalysisAttempts int                 `json:"analysisAttempts"`
	NextAttemptAt    *time.Time          `json:"nextAttemptAt,omitempty"`
	ID               string              `json:"id"`
	Title            string              `json:"title"`
	Channel          string              `json:"channel"`
	ExternalID       string              `json:"externalId"`
	SourceIDs        []string            `json:"sourceIds"`
	Text             string              `json:"text"`
	Attachments      []CompanyAttachment `json:"attachments"`
	CreatedAt        time.Time           `json:"createdAt"`
	UpdatedAt        time.Time           `json:"updatedAt"`
	Revision         int                 `json:"revision"`
	Status           string              `json:"status"`
	LastError        string              `json:"lastError,omitempty"`
	Analysis         json.RawMessage     `json:"analysis,omitempty"`
	Knowledge        []KnowledgePassage  `json:"knowledge"`
	Review           CompanyReview       `json:"review"`
	Estimate         *CompanyEstimate    `json:"estimate,omitempty"`
	Baselines        []CompanyBaseline   `json:"baselines"`
	Delivery         *deliveryOutcome    `json:"deliveryOutcome,omitempty"`
	DeliveryHistory  []deliveryOutcome   `json:"deliveryHistory,omitempty"`
}
type CompanyConnector struct {
	Connected    bool              `json:"connected"`
	LinkedBy     string            `json:"linkedBy"`
	LastSyncedAt *time.Time        `json:"lastSyncedAt,omitempty"`
	LastError    string            `json:"lastError,omitempty"`
	Query        string            `json:"query"`
	LeaseUntil   *time.Time        `json:"leaseUntil,omitempty"`
	Secrets      map[string]string `json:"secrets,omitempty"`
}
type WorkflowCompany struct {
	ID                  string              `json:"id"`
	Name                string              `json:"name"`
	Version             int64               `json:"version"`
	Config              CompanyConfig       `json:"config"`
	ConfigHistory       []CompanyConfig     `json:"configHistory"`
	Members             []CompanyMember     `json:"members"`
	Knowledge           []KnowledgeDocument `json:"knowledge"`
	Requests            []CompanyRequest    `json:"requests"`
	Audit               []CompanyAudit      `json:"audit"`
	Gmail               CompanyConnector    `json:"gmail"`
	WebhookSecret       string              `json:"webhookSecret,omitempty"`
	WebhookActor        string              `json:"webhookActor,omitempty"`
	KnowledgeTokenHash  string              `json:"knowledgeTokenHash,omitempty"`
	KnowledgeTokenActor string              `json:"knowledgeTokenActor,omitempty"`
	Role                string              `json:"role,omitempty"`
}
type companyAction struct {
	Automatic            bool                `json:"automatic"`
	StaffCount           float64             `json:"staffCount"`
	DependencyDays       float64             `json:"dependencyDays"`
	Action               string              `json:"action"`
	ExpectedVersion      int64               `json:"expectedVersion"`
	ExpectedRevision     int                 `json:"expectedRevision"`
	RequestID            string              `json:"requestId"`
	Title                string              `json:"title"`
	Text                 string              `json:"text"`
	Channel              string              `json:"channel"`
	ExternalID           string              `json:"externalId"`
	SourceIDs            []string            `json:"sourceIds"`
	Attachments          []CompanyAttachment `json:"attachments"`
	Config               CompanyConfig       `json:"config"`
	AccountID            string              `json:"accountId"`
	Role                 string              `json:"role"`
	Document             KnowledgeDocument   `json:"document"`
	DocumentID           string              `json:"documentId"`
	Decision             string              `json:"decision"`
	Note                 string              `json:"note"`
	Analysis             json.RawMessage     `json:"analysis"`
	Knowledge            []KnowledgePassage  `json:"knowledge"`
	Review               CompanyReview       `json:"review"`
	BaselineID           string              `json:"baselineId"`
	ReviewerID           string              `json:"reviewerId"`
	ActualHours          map[string]float64  `json:"actualHours"`
	AdditionalScopeHours float64             `json:"additionalScopeHours"`
	CompletedAt          time.Time           `json:"completedAt"`
	EvidenceSource       string              `json:"evidenceSource"`
	EvidenceReference    string              `json:"evidenceReference"`
	Synthetic            bool                `json:"synthetic"`
	Secrets              map[string]string   `json:"secrets"`
	Query                string              `json:"query"`
	Error                string              `json:"error"`
}
type workflowFailure struct {
	status  int
	message string
}

func (e workflowFailure) Error() string { return e.message }
func workflowBad(message string) error  { return workflowFailure{400, message} }
func workflowRole(role string, allowed ...string) bool {
	for _, v := range allowed {
		if role == v {
			return true
		}
	}
	return false
}
func requestTypes() []string {
	return []string{"demo", "setup", "migration", "integration", "customization", "support"}
}
func containsString(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func companyDefaults() CompanyConfig {
	return CompanyConfig{Version: 1, Fields: []IntakeField{
		{Key: "requester", Label: "Who is asking", Type: "string", Required: true},
		{Key: "organization", Label: "Company", Type: "string", Required: true},
		{Key: "outcome", Label: "Requested outcome", Type: "string", Required: true},
		{Key: "currentProcess", Label: "Current process", Type: "string"},
		{Key: "systems", Label: "Systems to connect", Type: "string", RequestTypes: []string{"integration"}},
		{Key: "volume", Label: "Records, documents, or users", Type: "number"},
		{Key: "timeline", Label: "Target date", Type: "string"},
		{Key: "budget", Label: "Budget, if supplied", Type: "string"},
	}, Products: []CompanyProduct{}, Tasks: []CompanyTask{}, Capabilities: []string{}, ApprovedDomains: []string{}, RetentionDays: 90, HoursPerDay: 6}
}
func validateCompanyConfig(c CompanyConfig) error {
	if len(c.Fields) > 60 || len(c.Products) > 30 || len(c.Tasks) > 80 || len(c.ApprovedDomains) > 30 || len(c.Capabilities) > 50 || c.RetentionDays < 1 || c.RetentionDays > 3650 || c.HoursPerDay <= 0 || c.HoursPerDay > 24 {
		return workflowBad("Configuration exceeds supported limits.")
	}
	seen := map[string]bool{}
	for _, capability := range c.Capabilities {
		if len(capability) > 300 {
			return workflowBad("Capability descriptions must be 300 characters or fewer.")
		}
	}
	for _, f := range c.Fields {
		if !regexp.MustCompile("^[A-Za-z][A-Za-z0-9_]{0,79}$").MatchString(f.Key) || containsString([]string{"constructor", "prototype", "__proto__", "requestType"}, f.Key) || len(f.Label) > 200 || seen[f.Key] || !containsString([]string{"string", "number", "boolean", "enum"}, f.Type) || len(f.Options) > 40 {
			return workflowBad("Fields need unique keys and a supported type.")
		}
		seen[f.Key] = true
		if f.Priority != "" && !containsString([]string{"high", "medium", "low"}, f.Priority) {
			return workflowBad("Field priority must be high, medium, or low.")
		}
		if len(f.Question) > 500 {
			return workflowBad("Clarification prompts must be 500 characters or fewer.")
		}
		if f.Type == "enum" && len(f.Options) == 0 {
			return workflowBad("An enum field needs allowed values.")
		}
		for _, option := range f.Options {
			if len(option) > 200 {
				return workflowBad("Field options must be 200 characters or fewer.")
			}
		}
		for _, kind := range f.RequestTypes {
			if !containsString(requestTypes(), kind) {
				return workflowBad("Unknown request type in a field rule.")
			}
		}
	}
	for _, f := range c.Fields {
		for key := range f.RequiredWhen {
			if !seen[key] {
				return workflowBad("A conditional field rule references an unknown field.")
			}
		}
	}
	seen = map[string]bool{}
	for _, t := range c.Tasks {
		if t.ID == "" || len(t.ID) > 80 || t.Label == "" || seen[t.ID] || !finiteHours(t.BaseHours) || t.BaseHours <= 0 || t.LowFactor <= 0 || t.LowFactor > 1 || t.HighFactor < 1 || t.HighFactor > 10 {
			return workflowBad("Tasks need unique IDs, positive base hours, and valid range factors.")
		}
		seen[t.ID] = true
		for _, kind := range t.RequestTypes {
			if !containsString(requestTypes(), kind) {
				return workflowBad("Unknown request type in a task rule.")
			}
		}
	}
	seen = map[string]bool{}
	for _, p := range c.Products {
		if p.ID == "" || len(p.ID) > 80 || p.Name == "" || len(p.Name) > 200 || len(p.Description) > 2000 || seen[p.ID] {
			return workflowBad("Products need unique IDs and names.")
		}
		seen[p.ID] = true
	}
	for _, d := range c.ApprovedDomains {
		u, err := url.Parse("https://" + d)
		if err != nil || u.Hostname() != d || strings.ContainsAny(d, "/:@*") || !strings.Contains(d, ".") {
			return workflowBad("Approved domains must be exact public host names.")
		}
	}
	return nil
}
func finiteHours(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1_000_000
}
func (store *recordStore) workflowPrincipal(w http.ResponseWriter, r *http.Request, scope string) (recordPrincipal, bool) {
	if store == nil {
		writeJSON(w, 503, map[string]string{"error": "Company storage is not configured."})
		return recordPrincipal{}, false
	}
	principal, err := verifyServiceToken(strings.TrimPrefix(r.Header.Get("authorization"), "Bearer "), store.serviceTokenKeys, scope, time.Now())
	if err != nil {
		writeJSON(w, 401, map[string]string{"error": "A verified company session is required."})
		return recordPrincipal{}, false
	}
	return principal, true
}
func (store *recordStore) handleCompanyWorkflow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("cache-control", "no-store")
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/workflow/"), "/")
	parts := strings.Split(path, "/")
	scope := "workflow:read"
	if r.Method != "GET" {
		scope = "workflow:write"
	}
	if path == "jobs" || strings.HasPrefix(path, "context/") {
		scope = "workflow:worker"
	} else if strings.HasSuffix(path, "/connector-secret") {
		scope = "workflow:connector"
	}
	principal, ok := store.workflowPrincipal(w, r, scope)
	if !ok {
		return
	}
	if path == "jobs" {
		store.companyJobs(w, r)
		return
	}
	if len(parts) == 2 && parts[0] == "context" && isUUID(parts[1]) && r.Method == "GET" {
		var nonce, ciphertext []byte
		if store.pool.QueryRow(r.Context(), "SELECT nonce,ciphertext FROM workflow_companies WHERE id=$1", parts[1]).Scan(&nonce, &ciphertext) != nil {
			writeJSON(w, 404, map[string]string{"error": "Company not found."})
			return
		}
		raw, e := store.decryptField(parts[1], parts[1], "company", nonce, ciphertext)
		var c WorkflowCompany
		if e != nil || json.Unmarshal(raw, &c) != nil {
			writeJSON(w, 503, map[string]string{"error": "Company context unavailable."})
			return
		}
		writeJSON(w, 200, map[string]any{"gmail": c.Gmail, "webhookSecret": c.WebhookSecret, "webhookActor": c.WebhookActor, "knowledgeTokenHash": c.KnowledgeTokenHash, "knowledgeTokenActor": c.KnowledgeTokenActor})
		return
	}
	if len(parts) < 1 || parts[0] != "companies" {
		writeJSON(w, 404, map[string]string{"error": "Unknown company endpoint."})
		return
	}
	if len(parts) == 1 {
		if r.Method == "GET" {
			store.listCompanies(w, r, principal)
			return
		}
		if r.Method == "POST" {
			store.createCompany(w, r, principal)
			return
		}
		writeJSON(w, 405, map[string]string{"error": "Unsupported company operation."})
		return
	}
	companyID := parts[1]
	if !isUUID(companyID) {
		writeJSON(w, 404, map[string]string{"error": "Company not found."})
		return
	}
	tx, err := store.pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Company storage unavailable."})
		return
	}
	defer tx.Rollback(r.Context())
	company, role, err := store.loadCompany(r.Context(), tx, companyID, principal, r.Method != "GET")
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "Company not found."})
		return
	}
	company.Role = role
	if r.Method == "GET" {
		switch {
		case len(parts) == 2:
			writeJSON(w, 200, companyView(company))
		case len(parts) == 3 && parts[2] == "connector-secret" && role == "admin":
			writeJSON(w, 200, map[string]any{"gmail": company.Gmail, "webhookSecret": company.WebhookSecret})
		case len(parts) == 3 && parts[2] == "knowledge":
			writeJSON(w, 200, map[string]any{"passages": searchCompanyKnowledge(company, r.URL.Query().Get("q"))})
		case len(parts) == 3 && parts[2] == "evaluation":
			writeJSON(w, 200, evaluateCompany(company))
		case len(parts) == 3 && parts[2] == "export":
			w.Header().Set("content-type", "application/x-ndjson")
			w.Header().Set("content-disposition", `attachment; filename="delivery-records.jsonl"`)
			enc := json.NewEncoder(w)
			for _, row := range companyEvaluationRows(company) {
				_ = enc.Encode(row)
			}
		case len(parts) == 3 && parts[2] == "schema":
			writeJSON(w, 200, companyIntakeSchema(company.Config))
		case len(parts) == 4 && parts[2] == "attachments" && isUUID(parts[3]):
			var nonce, ciphertext []byte
			if tx.QueryRow(r.Context(), "SELECT nonce,ciphertext FROM workflow_attachments WHERE id=$1 AND company_id=$2 AND expires_at>now()", parts[3], company.ID).Scan(&nonce, &ciphertext) != nil {
				writeJSON(w, 404, map[string]string{"error": "Attachment not found."})
				return
			}
			raw, e := store.decryptField(company.ID, parts[3], "attachment", nonce, ciphertext)
			if e != nil {
				writeJSON(w, 503, map[string]string{"error": "Attachment unavailable."})
				return
			}
			w.Header().Set("content-type", "application/octet-stream")
			w.Header().Set("content-disposition", "attachment")
			_, _ = w.Write(raw)
		default:
			writeJSON(w, 404, map[string]string{"error": "Unknown company resource."})
		}
		return
	}
	if r.Method == "DELETE" && len(parts) == 2 {
		if role != "admin" {
			writeJSON(w, 403, map[string]string{"error": "An administrator is required."})
			return
		}
		if _, err = tx.Exec(r.Context(), "DELETE FROM workflow_companies WHERE id=$1", company.ID); err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			writeJSON(w, 503, map[string]string{"error": "Company deletion failed."})
			return
		}
		w.WriteHeader(204)
		return
	}
	if r.Method != "POST" || len(parts) != 3 || parts[2] != "actions" {
		writeJSON(w, 405, map[string]string{"error": "Unsupported company operation."})
		return
	}
	var action companyAction
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024*1024))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&action); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Invalid company action."})
		return
	}
	if action.ExpectedVersion > 0 && action.ExpectedVersion != company.Version {
		writeJSON(w, 409, map[string]string{"error": "The workspace changed. Refresh before saving."})
		return
	}
	objectID, err := store.applyCompanyAction(r.Context(), tx, company, role, principal, action)
	if err != nil {
		var failure workflowFailure
		if errors.As(err, &failure) {
			writeJSON(w, failure.status, map[string]string{"error": failure.message})
		} else {
			writeJSON(w, 400, map[string]string{"error": "The company action could not be saved."})
		}
		return
	}
	company.Version++
	auditID := objectID
	if action.Action == "knowledge.token.rotate" {
		auditID = company.ID
	}
	company.Audit = append(company.Audit, CompanyAudit{At: time.Now().UTC(), Actor: principal.subject, Action: action.Action, ObjectID: auditID})
	if len(company.Audit) > 2000 {
		company.Audit = company.Audit[len(company.Audit)-2000:]
	}
	pruneCompany(company, time.Now())
	if err = store.saveCompany(r.Context(), tx, company); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Company changes could not be saved."})
		return
	}
	company.Role = role
	writeJSON(w, 200, map[string]any{"company": companyView(company), "objectId": objectID})
}
func (store *recordStore) loadCompany(ctx context.Context, tx pgx.Tx, id string, p recordPrincipal, lock bool) (*WorkflowCompany, string, error) {
	var nonce, ciphertext []byte
	var version int64
	var role string
	suffix := ""
	if lock {
		suffix = " FOR UPDATE OF c"
	}
	err := tx.QueryRow(ctx, "SELECT c.nonce,c.ciphertext,c.version,m.role FROM workflow_companies c JOIN workflow_members m ON c.id=m.company_id WHERE c.id=$1 AND m.account_key=$2"+suffix, id, store.ownerLookupKey(p)).Scan(&nonce, &ciphertext, &version, &role)
	if err != nil {
		return nil, "", err
	}
	raw, err := store.decryptField(id, id, "company", nonce, ciphertext)
	if err != nil {
		return nil, "", err
	}
	var company WorkflowCompany
	if err = json.Unmarshal(raw, &company); err != nil {
		return nil, "", err
	}
	company.Version = version
	pruneCompany(&company, time.Now())
	return &company, role, nil
}
func (store *recordStore) saveCompany(ctx context.Context, tx pgx.Tx, c *WorkflowCompany) error {
	c.Role = ""
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if len(raw) > 16_000_000 {
		return workflowBad("This workspace has reached its content limit. Export and archive completed requests.")
	}
	nonce, ciphertext, err := store.encryptField(c.ID, c.ID, "company", raw)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "UPDATE workflow_companies SET nonce=$1,ciphertext=$2,version=$3,updated_at=now() WHERE id=$4", nonce, ciphertext, c.Version, c.ID)
	return err
}
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
func (store *recordStore) listCompanies(w http.ResponseWriter, r *http.Request, p recordPrincipal) {
	rows, err := store.pool.Query(r.Context(), "SELECT company_id::text FROM workflow_members WHERE account_key=$1 ORDER BY company_id", store.ownerLookupKey(p))
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Companies could not be loaded."})
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	result := []map[string]any{}
	for _, id := range ids {
		tx, e := store.pool.Begin(r.Context())
		if e != nil {
			continue
		}
		c, role, e := store.loadCompany(r.Context(), tx, id, p, false)
		_ = tx.Rollback(r.Context())
		if e == nil {
			result = append(result, map[string]any{"id": id, "name": c.Name, "role": role, "version": c.Version})
		}
	}
	writeJSON(w, 200, map[string]any{"companies": result})
}
func (store *recordStore) createCompany(w http.ResponseWriter, r *http.Request, p recordPrincipal) {
	var input struct {
		Name string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil || len(strings.TrimSpace(input.Name)) < 2 || len(input.Name) > 120 {
		writeJSON(w, 400, map[string]string{"error": "Enter a company name between 2 and 120 characters."})
		return
	}
	var count int
	if store.pool.QueryRow(r.Context(), "SELECT count(*) FROM workflow_members WHERE account_key=$1", store.ownerLookupKey(p)).Scan(&count) != nil || count >= 20 {
		writeJSON(w, 400, map[string]string{"error": "Account company limit reached."})
		return
	}
	id, _ := newUUID()
	config := companyDefaults()
	c := WorkflowCompany{ID: id, Name: strings.TrimSpace(input.Name), Version: 1, Config: config, ConfigHistory: []CompanyConfig{config}, Members: []CompanyMember{{p.subject, "admin"}}, Knowledge: []KnowledgeDocument{}, Requests: []CompanyRequest{}, Audit: []CompanyAudit{{time.Now().UTC(), p.subject, "company.created", id}}, Gmail: CompanyConnector{Secrets: map[string]string{}}}
	raw, _ := json.Marshal(c)
	nonce, ciphertext, err := store.encryptField(id, id, "company", raw)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Company could not be created."})
		return
	}
	tx, err := store.pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Storage unavailable."})
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), "INSERT INTO workflow_companies(id,nonce,ciphertext,version) VALUES($1,$2,$3,1)", id, nonce, ciphertext)
	if err == nil {
		_, err = tx.Exec(r.Context(), "INSERT INTO workflow_members(company_id,account_key,role) VALUES($1,$2,'admin')", id, store.ownerLookupKey(p))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Company could not be created."})
		return
	}
	c.Role = "admin"
	writeJSON(w, 201, companyView(&c))
}
func (store *recordStore) companyJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := store.pool.Query(r.Context(), "SELECT id::text,nonce,ciphertext FROM workflow_companies ORDER BY updated_at LIMIT 200")
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Sync jobs unavailable."})
		return
	}
	defer rows.Close()
	jobs := []map[string]string{}
	analysisJobs := []map[string]string{}
	for rows.Next() {
		var id string
		var nonce, ciphertext []byte
		if rows.Scan(&id, &nonce, &ciphertext) != nil {
			continue
		}
		raw, e := store.decryptField(id, id, "company", nonce, ciphertext)
		if e != nil {
			continue
		}
		var c WorkflowCompany
		if json.Unmarshal(raw, &c) != nil {
			continue
		}
		if c.Gmail.Connected && c.Gmail.LinkedBy != "" && (c.Gmail.LeaseUntil == nil || c.Gmail.LeaseUntil.Before(time.Now())) {
			jobs = append(jobs, map[string]string{"companyId": id, "accountId": c.Gmail.LinkedBy})
		}
		for _, request := range c.Requests {
			activeCreator := false
			for _, member := range c.Members {
				if member.AccountID == request.CreatedBy {
					activeCreator = true
					break
				}
			}
			due := companyAnalysisDue(request, time.Now())
			if activeCreator && due && request.CreatedBy != "" && request.UpdatedAt.Add(time.Duration(c.Config.RetentionDays)*24*time.Hour).After(time.Now()) {
				analysisJobs = append(analysisJobs, map[string]string{"companyId": id, "accountId": request.CreatedBy, "requestId": request.ID})
			}
		}
	}
	writeJSON(w, 200, map[string]any{"jobs": jobs, "analysisJobs": analysisJobs})
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
func (store *recordStore) applyCompanyAction(ctx context.Context, tx pgx.Tx, c *WorkflowCompany, role string, p recordPrincipal, a companyAction) (string, error) {
	admin := []string{"config", "member", "removeMember", "knowledge.add", "knowledge.approve", "knowledge.retire", "gmail.configure", "gmail.tokens", "gmail.disconnect", "webhook.rotate", "knowledge.token.rotate", "knowledge.token.revoke"}
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
		c.Knowledge = append(c.Knowledge, d)
		return d.ID, nil
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
		if err := validateCompanyReview(c.Config, a.Review); err != nil {
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
		request.Status = "frozen"
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
func (store *recordStore) persistCompanyAttachments(ctx context.Context, tx pgx.Tx, c *WorkflowCompany, requestID string, files []CompanyAttachment) ([]CompanyAttachment, error) {
	total := 0
	for i := range files {
		file := &files[i]
		if file.ContentBase64 == "" {
			if file.ID == "" {
				file.ID, _ = newUUID()
			}
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(file.ContentBase64)
		if err != nil || len(raw) > 10*1024*1024 {
			return nil, workflowBad("Attachment bytes are invalid or exceed 10 MB.")
		}
		total += len(raw)
		if total > 20*1024*1024 {
			return nil, workflowBad("Attachment bytes exceed the 20 MB request limit.")
		}
		file.ID, _ = newUUID()
		file.SHA256 = sha256Hex(raw)
		nonce, ciphertext, err := store.encryptField(c.ID, file.ID, "attachment", raw)
		if err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO workflow_attachments(id,company_id,request_id,nonce,ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,$6)", file.ID, c.ID, requestID, nonce, ciphertext, time.Now().Add(time.Duration(c.Config.RetentionDays)*24*time.Hour)); err != nil {
			return nil, err
		}
		file.ContentBase64 = ""
	}
	return files, nil
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
	}
	if r.Confirmed && (strings.TrimSpace(r.Deliverables) == "" || strings.TrimSpace(r.Acceptance) == "") {
		return workflowBad("Confirm deliverables and acceptance criteria before approving scope.")
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
func (store *recordStore) cleanupCompanyRetention(ctx context.Context) error {
	if store == nil {
		return nil
	}
	if _, err := store.pool.Exec(ctx, "DELETE FROM workflow_attachments WHERE expires_at<=now()"); err != nil {
		return err
	}
	rows, err := store.pool.Query(ctx, "SELECT id::text FROM workflow_companies")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		tx, e := store.pool.Begin(ctx)
		if e != nil {
			return e
		}
		var nonce, ciphertext []byte
		var version int64
		e = tx.QueryRow(ctx, "SELECT nonce,ciphertext,version FROM workflow_companies WHERE id=$1 FOR UPDATE SKIP LOCKED", id).Scan(&nonce, &ciphertext, &version)
		if e != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		raw, e := store.decryptField(id, id, "company", nonce, ciphertext)
		var company WorkflowCompany
		if e != nil || json.Unmarshal(raw, &company) != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		before := len(company.Requests)
		pruneCompany(&company, time.Now())
		company.Version = version + 1
		if before != len(company.Requests) {
			if e = store.saveCompany(ctx, tx, &company); e != nil {
				_ = tx.Rollback(ctx)
				return e
			}
			if e = tx.Commit(ctx); e != nil {
				return e
			}
		} else {
			_ = tx.Rollback(ctx)
		}
	}
	return nil
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
