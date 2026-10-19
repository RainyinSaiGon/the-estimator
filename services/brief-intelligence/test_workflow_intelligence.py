import io
import unittest
import zipfile
from unittest.mock import patch

from fastapi import HTTPException
from pypdf import PdfWriter
from document_ingest import extract_document
from workflow_intelligence import WorkflowAnalysis, WorkflowInput, approved_address, validate_analysis


class WorkflowIntelligenceTests(unittest.TestCase):
    def request(self):
        return WorkflowInput(text="Please import the investor contacts from our spreadsheet.",
                             sources=[{"name": "Email", "text": "Please import the investor contacts from our spreadsheet."}],
                             configuration={"fields": [{"key": "outcome"}], "products": [{"id": "integration"}],
                                            "tasks": [{"id": "mapping"}]},
                             knowledge=[{"sourceId": "source-1", "passage": "The configured integration imports contacts."}])

    def analysis(self):
        return WorkflowAnalysis(summary="Import contacts", requestType="integration", productId="integration",
                                facts=[{"key": "outcome", "value": "Import", "sourceName": "Email",
                                        "evidence": "Made up evidence", "status": "source"}],
                                capabilityFindings=[], productFindings=[{"productId": "integration", "status": "supported",
                                                  "explanation": "Fits", "sourceId": "source-1", "evidence": "Unsupported quote"}],
                                assumptions=[], conflicts=[], questions=[], deliverables="Import contacts",
                                exclusions="", acceptance="Customer checks import", dependencies="Access",
                                workPackages=[{"id": "map", "taskId": "mapping", "title": "Map", "quantity": 1,
                                               "owner": "company", "acceptance": "Mapping verified", "dependencies": ""}])

    def test_unverified_facts_and_product_claims_are_unknown(self):
        result = validate_analysis(self.analysis(), self.request())
        self.assertEqual(result["facts"][0]["status"], "unknown")
        self.assertEqual(result["facts"][0]["value"], "")
        self.assertEqual(result["productFindings"][0]["status"], "unknown")

    def test_unconfigured_tasks_are_rejected(self):
        analysis = self.analysis()
        analysis.workPackages[0].taskId = "unconfigured"
        with self.assertRaises(ValueError):
            validate_analysis(analysis, self.request())

    def test_ssrf_blocks_private_resolution_and_unapproved_redirect_hosts(self):
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(ValueError):
                approved_address("https://docs.example.com/guide", ["docs.example.com"])
        with self.assertRaises(ValueError):
            approved_address("https://other.example.com/guide", ["docs.example.com"])
        with self.assertRaises(ValueError):
            approved_address("https://user:secret@docs.example.com/guide", ["docs.example.com"])

    def test_scanned_pdf_is_not_mistaken_for_extracted_page_labels(self):
        writer = PdfWriter()
        for _ in range(10):
            writer.add_blank_page(width=600, height=800)
        out = io.BytesIO()
        writer.write(out)
        with self.assertRaises(HTTPException) as raised:
            extract_document("scanned.pdf", out.getvalue())
        self.assertIn("OCR", str(raised.exception.detail))

    def test_excel_retains_sheet_name_row_and_inline_text(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Investor requests" r:id="rId1"/></sheets></workbook>')
            archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
            archive.writestr("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="7"><c t="inlineStr"><is><t>Import all investor contacts from the existing CRM.</t></is></c></row></sheetData></worksheet>')
        result = extract_document("requests.xlsx", out.getvalue())
        self.assertIn("Sheet: Investor requests", result["text"])
        self.assertIn("Row 7: Import all investor contacts", result["text"])

    def test_empty_slides_are_not_readable_content(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            for number in range(1, 15):
                archive.writestr(f"ppt/slides/slide{number}.xml", "<slide/>")
        with self.assertRaises(HTTPException):
            extract_document("empty.pptx", out.getvalue())

    def test_missing_required_fields_follow_admin_priority(self):
        request = self.request()
        request.configuration["fields"] = [
            {"key": "outcome", "required": True, "priority": "low", "question": "What outcome?"},
            {"key": "access", "required": True, "priority": "high", "question": "Who provides access?"}]
        result = validate_analysis(self.analysis(), request)
        self.assertEqual(result["questions"][:2], ["Who provides access?", "What outcome?"])


if __name__ == "__main__":
    unittest.main()
