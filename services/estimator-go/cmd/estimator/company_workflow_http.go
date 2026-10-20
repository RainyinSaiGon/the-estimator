package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

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
	if path == "jobs" || strings.HasPrefix(path, "context/") || strings.HasSuffix(path, "/knowledge-refresh-context") {
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
		company, err := store.readWorkflowCompanyContext(r.Context(), parts[1])
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "Company not found."})
			return
		}
		if err != nil {
			writeJSON(w, 503, map[string]string{"error": "Company context unavailable."})
			return
		}
		writeJSON(w, 200, map[string]any{"gmail": company.Gmail, "webhookSecret": company.WebhookSecret, "webhookActor": company.WebhookActor, "knowledgeTokenHash": company.KnowledgeTokenHash, "knowledgeTokenActor": company.KnowledgeTokenActor})
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
	tx, err := store.beginWorkflowTx(r.Context())
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Company storage unavailable."})
		return
	}
	defer rollbackWorkflowTx(r.Context(), tx)
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
		case len(parts) == 3 && parts[2] == "knowledge-refresh-context":
			writeJSON(w, 200, map[string]any{"config": company.Config, "knowledge": company.Knowledge})
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
			raw, err := store.readWorkflowAttachment(r.Context(), tx, company.ID, parts[3])
			if errors.Is(err, pgx.ErrNoRows) {
				writeJSON(w, 404, map[string]string{"error": "Attachment not found."})
				return
			}
			if err != nil {
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
		if err = store.deleteWorkflowCompany(r.Context(), tx, company.ID); err == nil {
			err = commitWorkflowTx(r.Context(), tx)
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
		err = commitWorkflowTx(r.Context(), tx)
	}
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Company changes could not be saved."})
		return
	}
	company.Role = role
	writeJSON(w, 200, map[string]any{"company": companyView(company), "objectId": objectID})
}
func (store *recordStore) listCompanies(w http.ResponseWriter, r *http.Request, p recordPrincipal) {
	companies, err := store.listWorkflowCompanies(r.Context(), p)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Companies could not be loaded."})
		return
	}
	writeJSON(w, 200, map[string]any{"companies": companies})
}
func (store *recordStore) createCompany(w http.ResponseWriter, r *http.Request, p recordPrincipal) {
	var input struct {
		Name string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil || len(strings.TrimSpace(input.Name)) < 2 || len(input.Name) > 120 {
		writeJSON(w, 400, map[string]string{"error": "Enter a company name between 2 and 120 characters."})
		return
	}
	c, err := store.createWorkflowCompany(r.Context(), p, input.Name)
	if err != nil {
		var failure workflowFailure
		if errors.As(err, &failure) {
			writeJSON(w, failure.status, map[string]string{"error": failure.message})
		} else {
			writeJSON(w, 503, map[string]string{"error": "Company could not be created."})
		}
		return
	}
	writeJSON(w, 201, companyView(c))
}
func (store *recordStore) companyJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := store.workflowCompanyJobs(r.Context())
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Sync jobs unavailable."})
		return
	}
	writeJSON(w, 200, jobs)
}
