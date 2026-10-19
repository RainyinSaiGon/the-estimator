package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

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
