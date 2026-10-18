package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type legacyOwnerMapping struct {
	LegacyOwnerID       string    `json:"legacyOwnerId"`
	FirstPartyAccountID string    `json:"firstPartyAccountId"`
	ReviewerID          string    `json:"reviewerId"`
	ReviewedAt          time.Time `json:"reviewedAt"`
	Reason              string    `json:"reason"`
}

type legacyOwnerMappings struct {
	Mappings []legacyOwnerMapping `json:"mappings"`
}

type legacyMigrationRow struct {
	OwnerID  string          `json:"ownerId"`
	RecordID string          `json:"recordId"`
	Project  json.RawMessage `json:"project"`
}

type legacyMigrationResult struct {
	Source     int            `json:"source"`
	Imported   int            `json:"imported"`
	RolledBack int            `json:"rolledBack,omitempty"`
	Skipped    int            `json:"skipped"`
	Rejected   int            `json:"rejected"`
	Reasons    map[string]int `json:"reasons"`
	DryRun     bool           `json:"dryRun"`
}

func runLegacyMigration(args []string) int {
	flags := flag.NewFlagSet("migrate-legacy", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	inputPath := flags.String("input", "", "legacy workspace export as JSONL")
	mappingPath := flags.String("owner-map", "", "reviewed legacy-owner to first-party account mapping JSON")
	apply := flags.Bool("apply", false, "write eligible records into the configured private-record database")
	rollback := flags.Bool("rollback", false, "remove only records imported by this migration input")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *inputPath == "" || *mappingPath == "" {
		fmt.Fprintln(os.Stderr, "usage: estimator migrate-legacy --input export.jsonl --owner-map owner-map.json [--apply]")
		return 2
	}
	if *apply && strings.EqualFold(strings.TrimSpace(os.Getenv("ESTIMATOR_ALLOW_LEGACY_IMPORT")), "true") == false {
		fmt.Fprintln(os.Stderr, "refusing writes: set ESTIMATOR_ALLOW_LEGACY_IMPORT=true for an explicitly reviewed local/candidate migration")
		return 2
	}
	mappings, err := loadOwnerMappings(*mappingPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "owner map:", err)
		return 2
	}
	file, err := os.Open(*inputPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "input:", err)
		return 2
	}
	defer file.Close()
	rows, err := readLegacyRows(file)
	if err != nil {
		fmt.Fprintln(os.Stderr, "input:", err)
		return 2
	}
	var store *recordStore
	if *apply {
		store, err = openRecordStore()
		if err != nil || store == nil {
			fmt.Fprintln(os.Stderr, "private-record database is unavailable or misconfigured")
			return 2
		}
		defer store.close()
	}
	var result legacyMigrationResult
	if *rollback {
		if !*apply {
			fmt.Fprintln(os.Stderr, "rollback requires --apply and ESTIMATOR_ALLOW_LEGACY_IMPORT=true")
			return 2
		}
		result = rollbackLegacyMigration(context.Background(), rows, mappings, store)
	} else {
		result = processLegacyMigration(context.Background(), rows, mappings, store, !*apply)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "report:", err)
		return 2
	}
	if result.Rejected > 0 {
		return 1
	}
	return 0
}

func loadOwnerMappings(path string) (map[string]legacyOwnerMapping, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.New("could not read mapping file")
	}
	if len(contents) > 1<<20 {
		return nil, errors.New("mapping file exceeds 1 MiB")
	}
	return parseOwnerMappings(contents)
}

func parseOwnerMappings(contents []byte) (map[string]legacyOwnerMapping, error) {
	var input legacyOwnerMappings
	if err := json.Unmarshal(contents, &input); err != nil {
		return nil, errors.New("mapping file must be valid JSON")
	}
	result := make(map[string]legacyOwnerMapping, len(input.Mappings))
	for _, mapping := range input.Mappings {
		mapping.LegacyOwnerID = strings.TrimSpace(mapping.LegacyOwnerID)
		mapping.ReviewerID = strings.TrimSpace(mapping.ReviewerID)
		mapping.Reason = strings.TrimSpace(mapping.Reason)
		if mapping.LegacyOwnerID == "" || len(mapping.LegacyOwnerID) > 256 || !isUUID(mapping.FirstPartyAccountID) || !isUUID(mapping.ReviewerID) || mapping.ReviewedAt.IsZero() || len(mapping.Reason) < 10 || len(mapping.Reason) > 1000 {
			return nil, errors.New("each mapping requires a legacy owner ID, UUID account and reviewer IDs, review timestamp, and reason of at least 10 characters")
		}
		if _, exists := result[mapping.LegacyOwnerID]; exists {
			return nil, errors.New("mapping file contains duplicate legacy owner IDs")
		}
		result[mapping.LegacyOwnerID] = mapping
	}
	if len(result) == 0 {
		return nil, errors.New("mapping file must contain at least one explicit mapping")
	}
	return result, nil
}

func readLegacyRows(source io.Reader) ([]legacyMigrationRow, error) {
	scanner := bufio.NewScanner(source)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	rows := make([]legacyMigrationRow, 0)
	seen := map[string]bool{}
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var row legacyMigrationRow
		if json.Unmarshal(line, &row) != nil || row.OwnerID == "" || row.RecordID == "" || !json.Valid(row.Project) {
			return nil, errors.New("each JSONL row must include ownerId, recordId, and a project object")
		}
		key := row.OwnerID + "\x00" + row.RecordID
		if seen[key] {
			return nil, errors.New("export contains duplicate ownerId/recordId pairs")
		}
		seen[key] = true
		row.Project = append(json.RawMessage(nil), row.Project...)
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, errors.New("could not read complete JSONL export")
	}
	return rows, nil
}

func processLegacyMigration(ctx context.Context, rows []legacyMigrationRow, mappings map[string]legacyOwnerMapping, store *recordStore, dryRun bool) legacyMigrationResult {
	result := legacyMigrationResult{Source: len(rows), Reasons: map[string]int{}, DryRun: dryRun}
	for _, row := range rows {
		mapping, exists := mappings[row.OwnerID]
		if !exists {
			result.Rejected++
			result.Reasons["missing_explicit_owner_mapping"]++
			continue
		}
		payload, title, err := convertLegacyProject(row, mapping)
		if err != nil {
			result.Rejected++
			result.Reasons[err.Error()]++
			continue
		}
		if dryRun {
			result.Skipped++
			result.Reasons["eligible_dry_run"]++
			continue
		}
		imported, reason := importLegacyRecord(ctx, store, row, mapping, payload, title)
		if imported {
			result.Imported++
		} else if reason == "already_imported" {
			result.Skipped++
			result.Reasons[reason]++
		} else {
			result.Rejected++
			result.Reasons[reason]++
		}
	}
	return result
}

func convertLegacyProject(row legacyMigrationRow, mapping legacyOwnerMapping) ([]byte, string, error) {
	var project map[string]json.RawMessage
	if json.Unmarshal(row.Project, &project) != nil || project == nil {
		return nil, "", errors.New("invalid_legacy_project")
	}
	var title string
	_ = json.Unmarshal(project["title"], &title)
	if title == "" {
		title = "Imported estimate " + row.RecordID
	}
	if len([]rune(title)) > 200 {
		title = string([]rune(title)[:200])
	}
	var brief string
	_ = json.Unmarshal(project["brief"], &brief)
	if strings.TrimSpace(brief) == "" || len(brief) > 200_000 {
		return nil, "", errors.New("missing_or_oversized_source_brief")
	}
	var scope map[string]any
	if json.Unmarshal(project["scope"], &scope) != nil || scope == nil {
		return nil, "", errors.New("missing_legacy_scope")
	}
	var versions []map[string]json.RawMessage
	if json.Unmarshal(project["versions"], &versions) != nil || len(versions) == 0 {
		return nil, "", errors.New("no_frozen_estimate_baseline")
	}
	latest := versions[len(versions)-1]
	estimateRaw := latest["estimate"]
	if len(estimateRaw) == 0 || !json.Valid(estimateRaw) {
		return nil, "", errors.New("latest_frozen_estimate_is_invalid")
	}
	var estimate map[string]any
	if json.Unmarshal(estimateRaw, &estimate) != nil || estimate == nil {
		return nil, "", errors.New("latest_frozen_estimate_is_invalid")
	}
	var baselineIDs []string
	for _, version := range versions {
		var id string
		_ = json.Unmarshal(version["id"], &id)
		if id != "" {
			baselineIDs = append(baselineIDs, id)
		}
	}
	var estimateModel struct {
		Tasks []struct {
			Category string `json:"category"`
		} `json:"tasks"`
		Hours *float64 `json:"hours"`
		Low   *int     `json:"low"`
		High  *int     `json:"high"`
	}
	if json.Unmarshal(estimateRaw, &estimateModel) != nil || estimateModel.Hours == nil || estimateModel.Low == nil || estimateModel.High == nil || len(estimateModel.Tasks) == 0 {
		return nil, "", errors.New("latest_frozen_estimate_is_invalid")
	}
	ids := make([]string, 0, len(estimateModel.Tasks))
	for _, task := range estimateModel.Tasks {
		if strings.TrimSpace(task.Category) == "" {
			return nil, "", errors.New("latest_estimate_work_package_id_missing")
		}
		ids = append(ids, task.Category)
	}
	createdAt := time.Time{}
	_ = json.Unmarshal(latest["at"], &createdAt)
	if createdAt.IsZero() {
		_ = json.Unmarshal(project["updatedAt"], &createdAt)
	}
	if createdAt.IsZero() {
		_ = json.Unmarshal(project["createdAt"], &createdAt)
	}
	if createdAt.IsZero() {
		return nil, "", errors.New("frozen_baseline_timestamp_missing")
	}
	baselineHashSource, _ := json.Marshal(struct {
		Estimate any `json:"estimate"`
		Scope    any `json:"scope"`
	}{estimate, scope})
	baselineHash := sha256Hex(baselineHashSource)
	baselineID := deterministicUUID(row.OwnerID + ":" + row.RecordID + ":baseline")
	baseline := frozenRecordBaseline{ID: baselineID, CreatedAt: createdAt.UTC(), SHA256: baselineHash, EstimateSHA256: sha256Hex(estimateRaw), PolicyVersion: "legacy-unknown", EngineVersion: "legacy-unknown", EvaluationSplit: "unassigned", WorkPackageIDs: ids}
	baseline.ScopeSHA256 = sha256Hex(mustJSON(scope))
	baselineJSON, _ := json.Marshal(baseline)
	decisions, _ := json.Marshal([]lifecycleReviewDecision{{ID: deterministicUUID(row.OwnerID + ":" + row.RecordID + ":mapping-review"), Kind: "legacy-owner-mapped", At: mapping.ReviewedAt.UTC(), ActorID: mapping.ReviewerID, Decision: "approved", Note: mapping.Reason}})
	legacyImport, _ := json.Marshal(map[string]any{"source": "legacy-workspace-export", "sourceRecordId": row.RecordID, "legacyOwnerId": row.OwnerID, "mappingReviewerId": mapping.ReviewerID, "mappingReviewedAt": mapping.ReviewedAt.UTC(), "mappingReason": mapping.Reason, "originalProject": json.RawMessage(row.Project), "historicalBaselineIds": baselineIDs, "provenanceStatus": "legacy-unknown"})
	provenance, _ := json.Marshal(map[string]any{"sourceSha256": sha256Hex([]byte(brief)), "sourceFacts": []any{}, "humanConfirmedFacts": []any{}, "provisionalInferences": []any{}, "modelSuggestions": []any{}, "analysis": map[string]any{"status": "unknown"}, "legacyUnknown": true})
	source, _ := json.Marshal(recordSource{Name: "legacy-brief.txt", Type: "text/plain", Characters: len([]rune(brief)), Truncated: false, ReviewText: brief})
	originalFile := project["originalFile"]
	if len(originalFile) == 0 {
		originalFile = []byte("null")
	}
	jsonValue := func(raw json.RawMessage) json.RawMessage {
		if len(raw) == 0 {
			return json.RawMessage(`{}`)
		}
		return raw
	}
	payload := map[string]json.RawMessage{}
	set := func(key string, value any) { encoded, _ := json.Marshal(value); payload[key] = encoded }
	set("schemaVersion", 2)
	set("title", title)
	payload["source"] = source
	payload["originalFile"] = originalFile
	payload["suggestedScope"] = jsonValue(project["scope"])
	payload["reviewedScope"] = jsonValue(project["scope"])
	payload["estimate"] = estimateRaw
	payload["deliveryOutcome"] = []byte("null")
	payload["baseline"] = baselineJSON
	payload["provenance"] = provenance
	payload["reviewDecisions"] = decisions
	payload["legacyImport"] = legacyImport
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, "", errors.New("legacy_record_conversion_failed")
	}
	var normalized recordPayload
	if json.Unmarshal(encoded, &normalized) != nil || !validRecordPayload(normalized) {
		return nil, "", errors.New("converted_legacy_record_failed_validation")
	}
	return encoded, title, nil
}

func importLegacyRecord(ctx context.Context, store *recordStore, row legacyMigrationRow, mapping legacyOwnerMapping, payload []byte, title string) (bool, string) {
	if store == nil {
		return false, "private_record_store_unavailable"
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(payload, &raw) != nil {
		return false, "converted_legacy_record_invalid"
	}
	digest := sha256Hex(row.Project)
	migrationKey := sha256Hex([]byte("legacy-v1\x00" + row.OwnerID + "\x00" + row.RecordID))
	principal := recordPrincipal{issuer: "first-party-v1", subject: mapping.FirstPartyAccountID}
	ownerKey := store.ownerLookupKey(principal)
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return false, "database_unavailable"
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var existingDigest string
	err = tx.QueryRow(ctx, `SELECT source_digest FROM estimator_migration_ledger WHERE migration_key = $1 FOR UPDATE`, migrationKey).Scan(&existingDigest)
	if err == nil {
		if existingDigest == digest {
			return false, "already_imported"
		}
		return false, "source_record_changed_since_import"
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, "migration_ledger_unavailable"
	}
	accountID, err := store.resolveAccount(ctx, tx, principal)
	if err != nil {
		return false, "target_account_unavailable"
	}
	recordID := deterministicUUID(row.OwnerID + ":" + row.RecordID)
	titleNonce, titleCiphertext, err := store.encryptField(accountID, recordID, "title", []byte(title))
	if err != nil {
		return false, "record_encryption_failed"
	}
	payloadNonce, payloadCiphertext, err := store.encryptField(accountID, recordID, "payload", payload)
	if err != nil {
		return false, "record_encryption_failed"
	}
	expiresAt := time.Now().UTC().AddDate(0, 0, store.retentionDays)
	if _, err := tx.Exec(ctx, `INSERT INTO estimator_records (id, account_id, schema_version, title_nonce, title_ciphertext, content_nonce, content_ciphertext, created_at, expires_at) VALUES ($1, $2, 2, $3, $4, $5, $6, now(), $7)`, recordID, accountID, titleNonce, titleCiphertext, payloadNonce, payloadCiphertext, expiresAt); err != nil {
		return false, "target_record_insert_failed"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO estimator_migration_ledger (migration_key, source_id, owner_key, record_id, source_digest, mapping_reviewer, mapping_reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, migrationKey, row.RecordID, ownerKey, recordID, digest, mapping.ReviewerID, mapping.ReviewedAt.UTC()); err != nil {
		return false, "migration_ledger_insert_failed"
	}
	if err := tx.Commit(ctx); err != nil {
		return false, "migration_commit_failed"
	}
	return true, ""
}

func rollbackLegacyMigration(ctx context.Context, rows []legacyMigrationRow, mappings map[string]legacyOwnerMapping, store *recordStore) legacyMigrationResult {
	result := legacyMigrationResult{Source: len(rows), Reasons: map[string]int{}}
	if store == nil {
		result.Rejected = len(rows)
		result.Reasons["private_record_store_unavailable"] = len(rows)
		return result
	}
	for _, row := range rows {
		if _, exists := mappings[row.OwnerID]; !exists {
			result.Rejected++
			result.Reasons["missing_explicit_owner_mapping"]++
			continue
		}
		migrationKey := sha256Hex([]byte("legacy-v1\x00" + row.OwnerID + "\x00" + row.RecordID))
		tx, err := store.pool.Begin(ctx)
		if err != nil {
			result.Rejected++
			result.Reasons["database_unavailable"]++
			continue
		}
		var recordID string
		err = tx.QueryRow(ctx, `SELECT record_id::text FROM estimator_migration_ledger WHERE migration_key = $1 FOR UPDATE`, migrationKey).Scan(&recordID)
		if errors.Is(err, pgx.ErrNoRows) {
			_ = tx.Rollback(ctx)
			result.Skipped++
			result.Reasons["not_imported_by_this_migration"]++
			continue
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			result.Rejected++
			result.Reasons["migration_ledger_unavailable"]++
			continue
		}
		if _, err = tx.Exec(ctx, `DELETE FROM estimator_records WHERE id = $1`, recordID); err != nil {
			_ = tx.Rollback(ctx)
			result.Rejected++
			result.Reasons["rollback_record_delete_failed"]++
			continue
		}
		if err = tx.Commit(ctx); err != nil {
			result.Rejected++
			result.Reasons["rollback_commit_failed"]++
			continue
		}
		result.RolledBack++
	}
	return result
}

func deterministicUUID(value string) string {
	sum := sha256.Sum256([]byte(value))
	bytes := sum[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(bytes)
	return hexValue[:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:]
}

func mustJSON(value any) []byte { encoded, _ := json.Marshal(value); return encoded }
