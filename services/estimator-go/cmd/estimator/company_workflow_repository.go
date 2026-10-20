package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type companyWorkflowSummary struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Version int64  `json:"version"`
}

type companyWorkflowJobs struct {
	Jobs          []map[string]string `json:"jobs"`
	AnalysisJobs  []map[string]string `json:"analysisJobs"`
	KnowledgeJobs []map[string]string `json:"knowledgeJobs"`
}

func (store *recordStore) beginWorkflowTx(ctx context.Context) (pgx.Tx, error) {
	return store.pool.Begin(ctx)
}

func commitWorkflowTx(ctx context.Context, tx pgx.Tx) error { return tx.Commit(ctx) }
func rollbackWorkflowTx(ctx context.Context, tx pgx.Tx)     { _ = tx.Rollback(ctx) }

func (store *recordStore) readWorkflowCompanyContext(ctx context.Context, id string) (*WorkflowCompany, error) {
	var nonce, ciphertext []byte
	if err := store.pool.QueryRow(ctx, "SELECT nonce,ciphertext FROM workflow_companies WHERE id=$1", id).Scan(&nonce, &ciphertext); err != nil {
		return nil, err
	}
	raw, err := store.decryptField(id, id, "company", nonce, ciphertext)
	if err != nil {
		return nil, err
	}
	var company WorkflowCompany
	if err = json.Unmarshal(raw, &company); err != nil {
		return nil, err
	}
	return &company, nil
}

func (store *recordStore) readWorkflowAttachment(ctx context.Context, tx pgx.Tx, companyID, attachmentID string) ([]byte, error) {
	var nonce, ciphertext []byte
	err := tx.QueryRow(ctx, "SELECT nonce,ciphertext FROM workflow_attachments WHERE id=$1 AND company_id=$2 AND expires_at>now()", attachmentID, companyID).Scan(&nonce, &ciphertext)
	if err != nil {
		return nil, err
	}
	return store.decryptField(companyID, attachmentID, "attachment", nonce, ciphertext)
}

func (store *recordStore) deleteWorkflowCompany(ctx context.Context, tx pgx.Tx, companyID string) error {
	_, err := tx.Exec(ctx, "DELETE FROM workflow_companies WHERE id=$1", companyID)
	return err
}

func (store *recordStore) listWorkflowCompanies(ctx context.Context, p recordPrincipal) ([]companyWorkflowSummary, error) {
	rows, err := store.pool.Query(ctx, "SELECT company_id::text FROM workflow_members WHERE account_key=$1 ORDER BY company_id", store.ownerLookupKey(p))
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	result := make([]companyWorkflowSummary, 0, len(ids))
	for _, id := range ids {
		tx, err := store.beginWorkflowTx(ctx)
		if err != nil {
			continue
		}
		company, role, loadErr := store.loadCompany(ctx, tx, id, p, false)
		rollbackWorkflowTx(ctx, tx)
		if loadErr == nil {
			result = append(result, companyWorkflowSummary{ID: id, Name: company.Name, Role: role, Version: company.Version})
		}
	}
	return result, nil
}

func (store *recordStore) createWorkflowCompany(ctx context.Context, p recordPrincipal, name string) (*WorkflowCompany, error) {
	var count int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM workflow_members WHERE account_key=$1", store.ownerLookupKey(p)).Scan(&count); err != nil {
		return nil, err
	}
	if count >= 20 {
		return nil, workflowBad("Account company limit reached.")
	}
	id, err := newUUID()
	if err != nil {
		return nil, err
	}
	config := companyDefaults()
	company := WorkflowCompany{ID: id, Name: strings.TrimSpace(name), Version: 1, Config: config, ConfigHistory: []CompanyConfig{config}, Members: []CompanyMember{{p.subject, "admin"}}, Knowledge: []KnowledgeDocument{}, Requests: []CompanyRequest{}, Audit: []CompanyAudit{{time.Now().UTC(), p.subject, "company.created", id}}, Gmail: CompanyConnector{Secrets: map[string]string{}}}
	raw, err := json.Marshal(company)
	if err != nil {
		return nil, err
	}
	nonce, ciphertext, err := store.encryptField(id, id, "company", raw)
	if err != nil {
		return nil, err
	}
	tx, err := store.beginWorkflowTx(ctx)
	if err != nil {
		return nil, err
	}
	defer rollbackWorkflowTx(ctx, tx)
	if _, err = tx.Exec(ctx, "INSERT INTO workflow_companies(id,nonce,ciphertext,version) VALUES($1,$2,$3,1)", id, nonce, ciphertext); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO workflow_members(company_id,account_key,role) VALUES($1,$2,'admin')", id, store.ownerLookupKey(p)); err != nil {
		return nil, err
	}
	if err = commitWorkflowTx(ctx, tx); err != nil {
		return nil, err
	}
	company.Role = "admin"
	return &company, nil
}

func (store *recordStore) workflowCompanyJobs(ctx context.Context) (companyWorkflowJobs, error) {
	rows, err := store.pool.Query(ctx, "SELECT id::text,nonce,ciphertext FROM workflow_companies ORDER BY updated_at LIMIT 200")
	if err != nil {
		return companyWorkflowJobs{}, err
	}
	defer rows.Close()
	result := companyWorkflowJobs{Jobs: []map[string]string{}, AnalysisJobs: []map[string]string{}, KnowledgeJobs: []map[string]string{}}
	for rows.Next() {
		var id string
		var nonce, ciphertext []byte
		if err := rows.Scan(&id, &nonce, &ciphertext); err != nil {
			return companyWorkflowJobs{}, err
		}
		raw, err := store.decryptField(id, id, "company", nonce, ciphertext)
		if err != nil {
			continue
		}
		var company WorkflowCompany
		if json.Unmarshal(raw, &company) != nil {
			continue
		}
		if company.Gmail.Connected && company.Gmail.LinkedBy != "" && (company.Gmail.LeaseUntil == nil || company.Gmail.LeaseUntil.Before(time.Now())) {
			result.Jobs = append(result.Jobs, map[string]string{"companyId": id, "accountId": company.Gmail.LinkedBy})
		}
		adminID := ""
		for _, member := range company.Members {
			if member.Role == "admin" {
				adminID = member.AccountID
				break
			}
		}
		for _, source := range company.Knowledge {
			lastAttempt := source.RetrievedAt
			if source.LastRefreshAttemptAt != nil {
				lastAttempt = *source.LastRefreshAttemptAt
			}
			if source.Status == "approved" && source.URL != "" && adminID != "" && !lastAttempt.After(time.Now().Add(-30*24*time.Hour)) {
				result.KnowledgeJobs = append(result.KnowledgeJobs, map[string]string{"companyId": id, "accountId": adminID, "documentId": source.ID})
			}
		}
		for _, request := range company.Requests {
			activeCreator := false
			for _, member := range company.Members {
				if member.AccountID == request.CreatedBy {
					activeCreator = true
					break
				}
			}
			due := companyAnalysisDue(request, time.Now())
			if activeCreator && due && request.CreatedBy != "" && request.UpdatedAt.Add(time.Duration(company.Config.RetentionDays)*24*time.Hour).After(time.Now()) {
				result.AnalysisJobs = append(result.AnalysisJobs, map[string]string{"companyId": id, "accountId": request.CreatedBy, "requestId": request.ID})
			}
		}
	}
	return result, rows.Err()
}

func (store *recordStore) removeWorkflowMember(ctx context.Context, tx pgx.Tx, companyID, accountKey string) error {
	_, err := tx.Exec(ctx, "DELETE FROM workflow_members WHERE company_id=$1 AND account_key=$2", companyID, accountKey)
	return err
}

func (store *recordStore) upsertWorkflowMember(ctx context.Context, tx pgx.Tx, companyID, accountKey, role string) error {
	_, err := tx.Exec(ctx, "INSERT INTO workflow_members(company_id,account_key,role) VALUES($1,$2,$3) ON CONFLICT(company_id,account_key) DO UPDATE SET role=EXCLUDED.role", companyID, accountKey, role)
	return err
}

func (store *recordStore) deleteWorkflowAttachments(ctx context.Context, tx pgx.Tx, companyID, requestID string) error {
	_, err := tx.Exec(ctx, "DELETE FROM workflow_attachments WHERE company_id=$1 AND request_id=$2", companyID, requestID)
	return err
}

func (store *recordStore) updateWorkflowAttachmentExpiry(ctx context.Context, tx pgx.Tx, companyID, requestID string, expiresAt time.Time) error {
	_, err := tx.Exec(ctx, "UPDATE workflow_attachments SET expires_at=$1 WHERE company_id=$2 AND request_id=$3", expiresAt, companyID, requestID)
	return err
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
		retained := map[string]bool{}
		pruneCompany(&company, time.Now())
		for _, request := range company.Requests {
			retained[request.ID] = true
		}
		for _, requestID := range requestIDsFromCompanyJSON(raw) {
			if !retained[requestID] {
				if _, e = tx.Exec(ctx, "DELETE FROM workflow_attachments WHERE company_id=$1 AND request_id=$2", id, requestID); e != nil {
					_ = tx.Rollback(ctx)
					return e
				}
			}
		}
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
func requestIDsFromCompanyJSON(raw []byte) []string {
	var company WorkflowCompany
	if json.Unmarshal(raw, &company) != nil {
		return nil
	}
	ids := make([]string, 0, len(company.Requests))
	for _, request := range company.Requests {
		ids = append(ids, request.ID)
	}
	return ids
}
