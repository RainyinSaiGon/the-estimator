"""Bounded text extraction for common client-request documents.

Extraction is intentionally local to the brief service. The caller keeps the
uploaded filename, while logs never include filename or document contents.
"""

from __future__ import annotations

import csv
import email
import html
import io
import json
import re
import zipfile
from email import policy
from email.parser import BytesParser
from pathlib import PurePosixPath
from xml.etree import ElementTree

from fastapi import HTTPException
from pypdf import PdfReader
import pymupdf as fitz
import pytesseract
from PIL import Image


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_EXTRACTED_CHARS = 20_000
MAX_OCR_PAGES = 10
MAX_ARCHIVE_FILES = 2_000
MAX_ARCHIVE_UNPACKED_BYTES = 30 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".txt", ".md", ".json", ".eml"}


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=422, detail="This file's text encoding could not be read.")


def _xml_text(raw: bytes) -> str:
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError as error:
        raise HTTPException(status_code=422, detail="This Office document is malformed.") from error
    return "\n".join(text.strip() for text in root.itertext() if text and text.strip())


def _xml_root(raw: bytes):
    try:
        return ElementTree.fromstring(raw)
    except ElementTree.ParseError as error:
        raise HTTPException(status_code=422, detail="This Office document contains malformed XML.") from error


def _safe_archive(raw: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except (zipfile.BadZipFile, OSError) as error:
        raise HTTPException(status_code=422, detail="This Office document is not a valid ZIP package.") from error
    items = archive.infolist()
    if len(items) > MAX_ARCHIVE_FILES or sum(item.file_size for item in items) > MAX_ARCHIVE_UNPACKED_BYTES:
        archive.close()
        raise HTTPException(status_code=413, detail="This Office document expands beyond the safe extraction limit.")
    if any(PurePosixPath(item.filename).is_absolute() or ".." in PurePosixPath(item.filename).parts for item in items):
        archive.close()
        raise HTTPException(status_code=422, detail="This Office document contains an unsafe package path.")
    return archive


def _extract_docx(raw: bytes) -> str:
    with _safe_archive(raw) as archive:
        try:
            document = archive.read("word/document.xml")
        except KeyError as error:
            raise HTTPException(status_code=422, detail="The Word document has no readable document body.") from error
    root = _xml_root(document)
    paragraphs = [" ".join(node.itertext()).strip() for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "p"]
    return "\n".join(f"Paragraph {index}\n{text}" for index, text in enumerate(paragraphs, 1) if text)


def _extract_xlsx(raw: bytes) -> str:
    with _safe_archive(raw) as archive:
        names = archive.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            shared_root = _xml_root(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in shared_root]
        sheet_names = sorted((name for name in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)), key=lambda name: int(re.search(r"sheet(\d+)", name).group(1)))
        sheet_titles = {}
        if "xl/workbook.xml" in names and "xl/_rels/workbook.xml.rels" in names:
            relationships = _xml_root(archive.read("xl/_rels/workbook.xml.rels"))
            targets = {node.attrib.get("Id"): node.attrib.get("Target", "") for node in relationships}
            workbook = _xml_root(archive.read("xl/workbook.xml"))
            for sheet in workbook.iter():
                if sheet.tag.rsplit("}", 1)[-1] == "sheet":
                    relation_id = next((value for key, value in sheet.attrib.items() if key.rsplit("}", 1)[-1] == "id"), "")
                    target = targets.get(relation_id, "")
                    normalized_target = target.lstrip("/") if target.startswith("/") else "xl/" + target
                    sheet_titles[normalized_target] = sheet.attrib.get("name", normalized_target)
        lines: list[str] = []
        for sheet_name in sheet_names:
            root = _xml_root(archive.read(sheet_name))
            rows: list[str] = []
            for row in root.iter():
                if row.tag.rsplit("}", 1)[-1] != "row":
                    continue
                values = []
                for cell in row:
                    if cell.tag.rsplit("}", 1)[-1] != "c":
                        continue
                    value = next((child.text or "" for child in cell if child.tag.rsplit("}", 1)[-1] == "v"), "")
                    if cell.attrib.get("t") == "inlineStr":
                        value = "".join(cell.itertext())
                    elif cell.attrib.get("t") == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                    values.append(value)
                if values:
                    rows.append(f"Row {row.attrib.get('r', len(rows) + 1)}: " + " | ".join(values))
            if rows:
                lines.extend([f"Sheet: {sheet_titles.get(sheet_name, PurePosixPath(sheet_name).stem)}", *rows])
    return "\n".join(lines)


def _extract_pptx(raw: bytes) -> str:
    with _safe_archive(raw) as archive:
        slides = sorted((name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)), key=lambda name: int(re.search(r"slide(\d+)", name).group(1)))
        lines = []
        for index, slide in enumerate(slides, start=1):
            content = _xml_text(archive.read(slide)).strip()
            if content:
                lines.extend([f"Slide {index}", content])
    return "\n".join(lines)


def _extract_eml(raw: bytes) -> str:
    try:
        message = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception as error:  # noqa: BLE001 - parser errors are normalized for the API.
        raise HTTPException(status_code=422, detail="This email file could not be parsed.") from error
    parts = message.walk() if message.is_multipart() else [message]
    bodies = []
    for part in parts:
        if part.get_content_disposition() == "attachment" or part.get_content_type() not in {"text/plain", "text/html"}:
            continue
        content = part.get_content()
        if isinstance(content, bytes):
            content = content.decode(part.get_content_charset() or "utf-8", errors="replace")
        if part.get_content_type() == "text/html":
            content = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", content)
            content = re.sub(r"(?s)<[^>]+>", " ", content)
            content = html.unescape(content)
        bodies.append(str(content))
    return "\n".join(bodies)


def extract_document(filename: str, raw: bytes) -> dict[str, str | bool]:
    """Validate, extract and bound a common client brief file."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Files must be 10 MB or smaller.")
    extension = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(status_code=415, detail=f"Unsupported file type. Supported types: {supported}.")
    if extension == ".pdf":
        if not raw.startswith(b"%PDF-"):
            raise HTTPException(status_code=422, detail="The uploaded file does not have a valid PDF signature.")
        try:
            reader = PdfReader(io.BytesIO(raw), strict=False)
            if len(reader.pages) > 150:
                raise HTTPException(status_code=413, detail="PDF files are limited to 150 pages.")
            pages = [page.extract_text() or "" for page in reader.pages]
            image_pages = [index for index, value in enumerate(pages) if len(value.strip()) < 30]
            if image_pages:
                if len(image_pages) > MAX_OCR_PAGES:
                    raise HTTPException(status_code=413, detail=f"OCR is limited to {MAX_OCR_PAGES} scanned pages per PDF. Split the document and upload reviewed parts.")
                try:
                    document = fitz.open(stream=raw, filetype="pdf")
                    for index in image_pages:
                        pixmap = document[index].get_pixmap(matrix=fitz.Matrix(1.7, 1.7), colorspace=fitz.csGRAY, alpha=False)
                        image = Image.frombytes("L", [pixmap.width, pixmap.height], pixmap.samples, "raw", "L", pixmap.stride)
                        pages[index] = pytesseract.image_to_string(image, lang="eng", timeout=2)
                except Exception as error:  # noqa: BLE001 - OCR errors are normalized for the API.
                    raise HTTPException(status_code=422, detail="Scanned PDF OCR could not complete. Check image quality or upload a searchable PDF.") from error
            if len("".join(pages).strip()) < 15:
                raise HTTPException(status_code=422, detail="OCR did not find enough readable text in this PDF. Check image quality or upload a searchable PDF.")
            text = "\n".join(f"Page {index}\n{value}" for index, value in enumerate(pages, 1))
        except HTTPException:
            raise
        except Exception as error:  # noqa: BLE001 - normalize parser errors.
            raise HTTPException(status_code=422, detail="This PDF could not be read. Password-protected or damaged PDFs are not supported.") from error
    elif extension == ".docx":
        text = _extract_docx(raw)
    elif extension == ".xlsx":
        text = _extract_xlsx(raw)
    elif extension == ".pptx":
        text = _extract_pptx(raw)
    elif extension == ".eml":
        text = _extract_eml(raw)
    elif extension == ".csv":
        try:
            rows = csv.reader(io.StringIO(_decode(raw)))
            text = "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)
        except csv.Error as error:
            raise HTTPException(status_code=422, detail="This CSV file could not be read.") from error
    elif extension == ".json":
        try:
            text = json.dumps(json.loads(_decode(raw)), ensure_ascii=False, indent=2)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail="This JSON file is malformed.") from error
    else:
        text = _decode(raw)
    normalized = "\n".join(line.strip() for line in text.replace("\x00", "").splitlines() if line.strip()).strip()
    if len(normalized) < 30:
        raise HTTPException(status_code=422, detail="Not enough readable text was found. Scanned images need OCR before analysis.")
    truncated = len(normalized) > MAX_EXTRACTED_CHARS
    return {"text": normalized[:MAX_EXTRACTED_CHARS], "extension": extension.lstrip("."), "truncated": truncated}
