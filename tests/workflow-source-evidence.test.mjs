import assert from "node:assert/strict";
import test from "node:test";
import { sourceLabelForQuote } from "../lib/workflow-source-evidence.ts";

const material = "[Source: Client message]\nPlease migrate contacts.\n\n[Source file: scope.docx; type: docx; references: Paragraph 1, Paragraph 2]\n[Paragraph 1] Context.\n\n[Paragraph 2] Customer owns access.\n\n[Source file: plan.xlsx; type: xlsx; references: Sheet Migration]\n[Sheet: Migration]\nContact count,3000";

test("quotes beginning with a reference retain that reference", () => {
  assert.equal(sourceLabelForQuote(material, "[Paragraph 2] Customer owns access."), "scope.docx (docx) · Paragraph 2");
  assert.equal(sourceLabelForQuote(material, "[Sheet: Migration]\nContact count,3000"), "plan.xlsx (xlsx) · Sheet: Migration");
});

test("quotes inside a source use its preceding location", () => {
  assert.equal(sourceLabelForQuote(material, "Customer owns access."), "scope.docx (docx) · Paragraph 2");
  assert.equal(sourceLabelForQuote(material, "Please migrate contacts."), "Client message");
});

test("unsupported and empty evidence are not attributed", () => {
  assert.equal(sourceLabelForQuote(material, "Unsupported claim"), "Unverified inference");
  assert.equal(sourceLabelForQuote(material, ""), "Unverified inference");
});
