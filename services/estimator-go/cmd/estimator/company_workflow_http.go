package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
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
	knowledgeJobs := []map[string]string{}
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
		adminID := ""
		for _, member := range c.Members {
			if member.Role == "admin" {
				adminID = member.AccountID
				break
			}
		}
		for _, source := range c.Knowledge {
			lastAttempt := source.RetrievedAt
			if source.LastRefreshAttemptAt != nil {
				lastAttempt = *source.LastRefreshAttemptAt
			}
			if source.Status == "approved" && source.URL != "" && adminID != "" && !lastAttempt.After(time.Now().Add(-30*24*time.Hour)) {
				knowledgeJobs = append(knowledgeJobs, map[string]string{"companyId": id, "accountId": adminID, "documentId": source.ID})
			}
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
	writeJSON(w, 200, map[string]any{"jobs": jobs, "analysisJobs": analysisJobs, "knowledgeJobs": knowledgeJobs})
}
