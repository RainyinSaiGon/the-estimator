package main

import (
	_ "embed"
	"encoding/json"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
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
	ID                   string     `json:"id"`
	Title                string     `json:"title"`
	URL                  string     `json:"url"`
	Text                 string     `json:"text"`
	SHA256               string     `json:"sha256"`
	Status               string     `json:"status"`
	RetrievedAt          time.Time  `json:"retrievedAt"`
	ApprovedAt           *time.Time `json:"approvedAt,omitempty"`
	ApprovedBy           string     `json:"approvedBy,omitempty"`
	ReplacesID           string     `json:"replacesId,omitempty"`
	LastRefreshAttemptAt *time.Time `json:"lastRefreshAttemptAt,omitempty"`
	LastRefreshError     string     `json:"lastRefreshError,omitempty"`
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
	Basis        string  `json:"basis,omitempty"`
	SourceName   string  `json:"sourceName,omitempty"`
	Evidence     string  `json:"evidence,omitempty"`
}
type CompanyTaskTracking struct {
	BaselineID    string    `json:"baselineId"`
	WorkPackageID string    `json:"workPackageId"`
	Status        string    `json:"status"`
	AssigneeID    string    `json:"assigneeId,omitempty"`
	PlannedStart  string    `json:"plannedStart,omitempty"`
	TargetDate    string    `json:"targetDate,omitempty"`
	Note          string    `json:"note,omitempty"`
	UpdatedAt     time.Time `json:"updatedAt"`
	UpdatedBy     string    `json:"updatedBy"`
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
	PlanningDays          float64               `json:"planningDays,omitempty"`
	ProjectedDeliveryDate string                `json:"projectedDeliveryDate,omitempty"`
	StaffCount            float64               `json:"staffCount,omitempty"`
	DependencyDays        float64               `json:"dependencyDays,omitempty"`
	Hours                 float64               `json:"hours"`
	BaseHours             float64               `json:"baseHours"`
	Low                   float64               `json:"low"`
	High                  float64               `json:"high"`
	Tasks                 []CompanyEstimateTask `json:"tasks"`
	ConfigVersion         int                   `json:"configVersion"`
	EngineVersion         string                `json:"engineVersion"`
	Limitation            string                `json:"limitation"`
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
	CreatedBy        string                `json:"createdBy"`
	AnalysisAttempts int                   `json:"analysisAttempts"`
	NextAttemptAt    *time.Time            `json:"nextAttemptAt,omitempty"`
	ID               string                `json:"id"`
	Title            string                `json:"title"`
	Channel          string                `json:"channel"`
	ExternalID       string                `json:"externalId"`
	SourceIDs        []string              `json:"sourceIds"`
	Text             string                `json:"text"`
	Attachments      []CompanyAttachment   `json:"attachments"`
	CreatedAt        time.Time             `json:"createdAt"`
	UpdatedAt        time.Time             `json:"updatedAt"`
	Revision         int                   `json:"revision"`
	Status           string                `json:"status"`
	LastError        string                `json:"lastError,omitempty"`
	Analysis         json.RawMessage       `json:"analysis,omitempty"`
	Knowledge        []KnowledgePassage    `json:"knowledge"`
	Review           CompanyReview         `json:"review"`
	Estimate         *CompanyEstimate      `json:"estimate,omitempty"`
	Baselines        []CompanyBaseline     `json:"baselines"`
	Tracking         []CompanyTaskTracking `json:"tracking,omitempty"`
	Delivery         *deliveryOutcome      `json:"deliveryOutcome,omitempty"`
	DeliveryHistory  []deliveryOutcome     `json:"deliveryHistory,omitempty"`
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
	StartDate            string              `json:"startDate"`
	WorkPackageID        string              `json:"workPackageId"`
	TrackingStatus       string              `json:"status"`
	AssigneeID           string              `json:"assigneeId"`
	PlannedStart         string              `json:"plannedStart"`
	TargetDate           string              `json:"targetDate"`
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

func workflowBad(message string) error { return workflowFailure{400, message} }
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
