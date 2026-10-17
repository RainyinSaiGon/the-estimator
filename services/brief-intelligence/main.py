import re

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="The Estimator Brief Intelligence", version="0.1.0")


class AnalyzeRequest(BaseModel):
    brief: str = Field(min_length=30, max_length=20_000)
    parser: str = "sample"


def sample_scope(brief: str) -> dict:
    lines = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", brief) if part.strip()]

    def evidence(pattern: str) -> str:
        return next((line for line in lines if re.search(pattern, line, re.IGNORECASE)), "")

    migration = evidence(r"\b(csv|migrat\w*|import\w*|historical|legacy)\b")
    sync = evidence(r"\b(sync\w*|nightly|every night|integrat\w*|connect\w*)\b")
    dedup = evidence(r"\b(duplicat\w*|dedup\w*|reconcil\w*)\b")
    if not migration and not sync:
        raise HTTPException(status_code=422, detail="This MVP supports data imports and CRM / API integrations. Describe the import or integration you need.")

    answers = {"direction": "unknown", "api": "unknown", "quality": "unknown", "volume": "unknown", "mapping": "unknown"}
    if re.search(r"two.way|bi.?directional|both directions", brief, re.IGNORECASE):
        answers["direction"] = "two-way"
    elif re.search(r"one.way|unidirectional", brief, re.IGNORECASE):
        answers["direction"] = "one-way"
    if re.search(r"duplicat|missing (company|fields|values)|incomplete|dirty", brief, re.IGNORECASE):
        answers["quality"] = "mixed"
    match = re.search(r"\b(\d[\d,]*)\s+(?:existing\s+)?(?:contacts|customers|records|rows)\b", brief, re.IGNORECASE)
    if match:
        count = int(match.group(1).replace(",", ""))
        answers["volume"] = "small" if count < 10_000 else "medium" if count <= 100_000 else "large"

    requirements = [{"id": "mapping", "title": "Map records to destination fields", "evidence": migration or sync}]
    if migration:
        requirements.append({"id": "import", "title": "Import historical records", "evidence": migration})
    if sync:
        requirements.append({"id": "sync", "title": "Connect systems and synchronize updates", "evidence": sync})
    if dedup:
        requirements.append({"id": "deduplication", "title": "Detect duplicates and reconcile records", "evidence": dedup})
    return {
        "summary": "Deliver a reliable connection between client systems and clean, reusable customer data.",
        "requirements": requirements,
        "initialAnswers": answers,
        "risks": [
            "Acceptance criteria and field mappings need delivery review.",
            "The client's requested date is a constraint, not a confirmed delivery commitment.",
        ],
        "parser": "demo",
    }


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    return {"status": "ready", "parser": "sample"}


@app.post("/v1/briefs/analyze")
def analyze(request: AnalyzeRequest):
    if request.parser != "sample":
        raise HTTPException(status_code=503, detail="AI parsing is not configured. Choose the sample parser.")
    return sample_scope(request.brief)
