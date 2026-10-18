package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestInitializeRecordLifecycleFreezesProvenanceAndDeterministicSplit(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":2,"title":"Reviewed","source":{"name":"brief.txt","type":"txt","characters":38,"truncated":false,"reviewText":"Import contacts and sync them nightly."},"originalFile":null,"suggestedScope":{"parser":"sample","requirements":[]},"reviewedScope":{"parser":"sample","requirements":[{"id":"import","evidence":"Import contacts"}],"risks":[],"missingInformation":[],"capabilityFindings":[]},"estimate":{"hours":5,"baseHours":5,"low":4,"high":6,"tasks":[{"category":"import"}],"provenance":{"engineVersion":"integration-effort/2.0","policyVersion":"fixed-calibration/v1"}},"deliveryOutcome":null}`)
	var payload recordPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	initialized, err := initializeRecordLifecycle(raw, payload, "5d10f5a7-8e8a-4c07-a75b-353f567aa3be", recordPrincipal{subject: "0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce"}, now)
	if err != nil {
		t.Fatalf("initializeRecordLifecycle() error = %v", err)
	}
	if err := json.Unmarshal(initialized, &payload); err != nil {
		t.Fatal(err)
	}
	if !validRecordPayload(payload) {
		t.Fatal("initialized v2 record did not validate")
	}
	var baseline frozenRecordBaseline
	if err := json.Unmarshal(payload.Baseline, &baseline); err != nil {
		t.Fatal(err)
	}
	if baseline.CreatedAt != now || baseline.EngineVersion != "integration-effort/2.0" || baseline.PolicyVersion != "fixed-calibration/v1" || len(baseline.SHA256) != 64 || len(baseline.WorkPackageIDs) != 1 || baseline.WorkPackageIDs[0] != "import" {
		t.Fatalf("unexpected frozen baseline: %#v", baseline)
	}
	if split := frozenEvaluationSplit("5d10f5a7-8e8a-4c07-a75b-353f567aa3be"); baseline.EvaluationSplit != split {
		t.Fatalf("split = %q, want deterministic %q", baseline.EvaluationSplit, split)
	}
	var provenance map[string]any
	if err := json.Unmarshal(payload.Provenance, &provenance); err != nil {
		t.Fatal(err)
	}
	if provenance["sourceSha256"] != sha256Hex([]byte("Import contacts and sync them nightly.")) {
		t.Fatal("source hash does not match the extracted source")
	}
	var decisions []lifecycleReviewDecision
	if err := json.Unmarshal(payload.ReviewDecisions, &decisions); err != nil || len(decisions) != 1 || decisions[0].ActorID != "0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce" {
		t.Fatalf("scope review attribution missing: %#v (%v)", decisions, err)
	}
}

func TestDeliveryOutcomeRequiresExactFrozenWorkPackagesAndSeparateAddedScope(t *testing.T) {
	baseline := frozenRecordBaseline{ID: "5d10f5a7-8e8a-4c07-a75b-353f567aa3be", CreatedAt: time.Now().Add(-time.Hour), SHA256: strings.Repeat("a", 64), EvaluationSplit: "training", WorkPackageIDs: []string{"import", "sync"}}
	input := createDeliveryRequest{BaselineID: baseline.ID, BaselineSHA256: baseline.SHA256, CompletedAt: time.Now(), ActualHours: map[string]float64{"import": 6, "sync": 3}, AdditionalHours: 4, EvidenceSource: "timesheet", EvidenceReference: "timesheet-2026-44"}
	if !validDeliveryInput(input, baseline) {
		t.Fatal("complete task-level actuals should be accepted")
	}
	input.ActualHours["new-scope"] = 2
	if validDeliveryInput(input, baseline) {
		t.Fatal("added work package must not be mixed into original scope")
	}
	input.ActualHours = map[string]float64{"import": 6}
	if validDeliveryInput(input, baseline) {
		t.Fatal("incomplete original-scope actuals must be rejected")
	}
}

func TestDeliveryCalibrationRequiresHumanApprovalAndVerifiedRecordedEvidence(t *testing.T) {
	outcome := deliveryOutcome{ReviewStatus: "pending", EvidenceSource: "timesheet", EvidenceReference: "ref-123"}
	if eligible, _ := deliveryEligibility(outcome); eligible {
		t.Fatal("pending outcome must not calibrate")
	}
	outcome.ReviewStatus = "approved"
	if eligible, _ := deliveryEligibility(outcome); !eligible {
		t.Fatal("approved, sourced recorded outcome should calibrate")
	}
	outcome.Synthetic = true
	if eligible, _ := deliveryEligibility(outcome); eligible {
		t.Fatal("synthetic outcome must not enter recorded calibration")
	}
	outcome.Synthetic = false
	outcome.EvidenceSource = "unknown"
	if eligible, _ := deliveryEligibility(outcome); eligible {
		t.Fatal("unknown provenance must be excluded")
	}
}

func TestLegacyMigrationPreservesProjectAndFrozenVersionsAsUnknownProvenance(t *testing.T) {
	project := json.RawMessage(`{"title":"Legacy CRM","brief":"Import 20 contacts and sync nightly.","scope":{"summary":"CRM import","domain":"integration","requirements":[{"id":"import","evidence":"Import 20 contacts"}]},"versions":[{"id":"v1","at":"2026-10-01T12:00:00Z","estimate":{"hours":5,"baseHours":5,"low":4,"high":6,"tasks":[{"category":"import","label":"Import"}]}}],"actuals":{"hours":{"import":7},"additionalHours":2,"synthetic":true}}`)
	row := legacyMigrationRow{OwnerID: "legacy-owner", RecordID: "project-1", Project: project}
	mapping := legacyOwnerMapping{LegacyOwnerID: "legacy-owner", FirstPartyAccountID: "0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce", ReviewerID: "5d10f5a7-8e8a-4c07-a75b-353f567aa3be", ReviewedAt: time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC), Reason: "Owner verified with an approved account link."}
	payloadBytes, _, err := convertLegacyProject(row, mapping)
	if err != nil {
		t.Fatalf("convertLegacyProject() error = %v", err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		t.Fatal(err)
	}
	var archived struct {
		OriginalProject  json.RawMessage `json:"originalProject"`
		ProvenanceStatus string          `json:"provenanceStatus"`
	}
	var migration map[string]json.RawMessage
	if err := json.Unmarshal(payload["legacyImport"], &migration); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload["legacyImport"], &archived); err != nil {
		t.Fatal(err)
	}
	if !json.Valid(archived.OriginalProject) || archived.ProvenanceStatus != "legacy-unknown" || !strings.Contains(string(archived.OriginalProject), `"synthetic":true`) || !strings.Contains(string(archived.OriginalProject), `"additionalHours":2`) {
		t.Fatal("migration did not retain original project, actuals, synthetic label, and unknown-provenance status")
	}
	var baseline frozenRecordBaseline
	if err := json.Unmarshal(payload["baseline"], &baseline); err != nil {
		t.Fatal(err)
	}
	if baseline.EvaluationSplit != "unassigned" || baseline.EngineVersion != "legacy-unknown" {
		t.Fatalf("legacy estimate was incorrectly assigned to evaluation: %#v", baseline)
	}
	var parsed recordPayload
	if err := json.Unmarshal(payloadBytes, &parsed); err != nil || !validRecordPayload(parsed) {
		t.Fatalf("converted legacy record should validate: %v", err)
	}
}

func TestLegacyMigrationRejectsMissingMappingAndIsStable(t *testing.T) {
	validMapping := []byte(`{"mappings":[{"legacyOwnerId":"old","firstPartyAccountId":"00000000-0000-4000-8000-000000000001","reviewerId":"00000000-0000-4000-8000-000000000002","reviewedAt":"2026-10-18T12:00:00Z","reason":"Verified with approved account link."}]}`)
	if _, err := parseOwnerMappings(validMapping); err != nil {
		t.Fatal(err)
	}
	if _, err := parseOwnerMappings([]byte(`{"mappings":[{"legacyOwnerId":"old","firstPartyAccountId":"00000000-0000-4000-8000-000000000001","reviewerId":"00000000-0000-4000-8000-000000000002","reviewedAt":"2026-10-18T12:00:00Z","reason":"short"}]}`)); err == nil {
		t.Fatal("unreviewed or insufficiently explained owner mappings must be rejected")
	}
	if _, err := parseOwnerMappings([]byte(`{"mappings":[{"legacyOwnerId":"old","firstPartyAccountId":"00000000-0000-4000-8000-000000000001","reviewerId":"00000000-0000-4000-8000-000000000002","reviewedAt":"2026-10-18T12:00:00Z","reason":"Verified with approved account link."},{"legacyOwnerId":"old","firstPartyAccountId":"00000000-0000-4000-8000-000000000001","reviewerId":"00000000-0000-4000-8000-000000000002","reviewedAt":"2026-10-18T12:00:00Z","reason":"Verified with approved account link."}]}`)); err == nil {
		t.Fatal("duplicate owner mappings must be rejected")
	}
	if deterministicUUID("owner:record") != deterministicUUID("owner:record") || !isUUID(deterministicUUID("owner:record")) {
		t.Fatal("legacy record IDs must be stable valid UUIDs")
	}
	if _, err := readLegacyRows(strings.NewReader("{\"ownerId\":\"owner\",\"recordId\":\"id\",\"project\":{}}\n{\"ownerId\":\"owner\",\"recordId\":\"id\",\"project\":{}}\n")); err == nil {
		t.Fatal("duplicate source rows must be rejected")
	}
	result := processLegacyMigration(nil, []legacyMigrationRow{{OwnerID: "unmapped", RecordID: "id", Project: json.RawMessage(`{}`)}}, map[string]legacyOwnerMapping{}, nil, true)
	if result.Source != 1 || result.Rejected != 1 || result.Reasons["missing_explicit_owner_mapping"] != 1 {
		t.Fatalf("unexpected dry-run reconciliation: %#v", result)
	}
}
