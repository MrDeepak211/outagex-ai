from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dotenv import load_dotenv

import os
import anthropic
import json
import re
import io

from datetime import datetime
from typing import List, Optional

from signal_extractor import extract

# ─────────────────────────────────────────────────────────────
# LOAD ENV
# ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=".env")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY not found in .env file")

# ─────────────────────────────────────────────────────────────
# FASTAPI
# ─────────────────────────────────────────────────────────────

app = FastAPI(title="OutageX AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# ─────────────────────────────────────────────────────────────
# ANTHROPIC CLIENT
# ─────────────────────────────────────────────────────────────

client = anthropic.Anthropic(
    api_key=ANTHROPIC_API_KEY
)

# ─────────────────────────────────────────────────────────────
# SYSTEM PROMPTS
# ─────────────────────────────────────────────────────────────

ANALYZE_SYSTEM = """
You are OutageX AI — an expert autonomous SRE incident analyzer.

Return ONLY valid JSON:

{
  "severity": "LOW|MEDIUM|HIGH|CRITICAL",
  "severity_reason": "one sentence",
  "root_cause": "one sentence",
  "affected_services": ["svc1"],
  "business_impact": "impact summary",
  "timeline": [
    {
      "time":"HH:MM:SS",
      "event":"event"
    }
  ],
  "recommendation": "1. fix\\n2. fix",
  "summary": "executive summary",
  "confidence": 90,
  "signals_used": ["signal1"]
}
"""

CHAT_SYSTEM = """
You are OutageX AI, an expert SRE assistant.
Give concise technical answers.
"""

REPORT_SYSTEM = """
Generate a professional outage post-mortem report.
"""

# ─────────────────────────────────────────────────────────────
# REQUEST MODELS
# ─────────────────────────────────────────────────────────────

class LogRequest(BaseModel):
    logs: str
    source: Optional[str] = "unknown"

class ChatRequest(BaseModel):
    logs: str
    analysis: dict
    history: List[dict]
    question: str

class ReportRequest(BaseModel):
    logs: str
    analysis: dict
    source: Optional[str] = "unknown"

# ─────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {
        "status": "ok",
        "version": "3.0",
        "engine": "hybrid"
    }

# ─────────────────────────────────────────────────────────────
# ANALYZE
# ─────────────────────────────────────────────────────────────

@app.post("/analyze")
def analyze_logs(data: LogRequest):

    try:

        # STEP 1 — SIGNAL EXTRACTION
        signals = extract(data.logs)

        # STEP 2 — ENRICHED PROMPT
        enriched_prompt = f"""
Source: {data.source}

{signals.summary_context}

Raw Logs:
{data.logs}

Affected Services:
{', '.join(signals.affected_services)}

Error Counts:
{json.dumps(signals.error_counts)}

Metrics:
{json.dumps(signals.metrics)}

Generate final JSON analysis.
"""

        # STEP 3 — AI ANALYSIS
        msg = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=1200,
            system=ANALYZE_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": enriched_prompt
                }
            ]
        )

        raw = msg.content[0].text.strip()

        raw = re.sub(
            r"^```json|^```|```$",
            "",
            raw,
            flags=re.MULTILINE
        ).strip()

        result = json.loads(raw)

        # STEP 4 — ATTACH SIGNALS
        result["_signals"] = [
            {
                "category": s.category,
                "code": s.code,
                "description": s.description,
                "count": s.count
            }
            for s in signals.signals
        ]

        result["_metrics"] = signals.metrics
        result["_error_counts"] = signals.error_counts
        result["_severity_score"] = signals.severity_score
        result["_suggested_severity"] = signals.suggested_severity

        return result

    except Exception as e:

        return {
            "severity": "ERROR",
            "summary": "AI analysis failed",
            "error": str(e)
        }

# ─────────────────────────────────────────────────────────────
# CHAT
# ─────────────────────────────────────────────────────────────

@app.post("/chat")
def chat(data: ChatRequest):

    try:

        context = f"""
Logs:
{data.logs}

Analysis:
{json.dumps(data.analysis, indent=2)}
"""

        messages = [
            {
                "role": "user",
                "content": context
            }
        ]

        for m in data.history:
            messages.append({
                "role": m["role"],
                "content": m["content"]
            })

        messages.append({
            "role": "user",
            "content": data.question
        })

        msg = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=600,
            system=CHAT_SYSTEM,
            messages=messages
        )

        return {
            "answer": msg.content[0].text.strip()
        }

    except Exception as e:

        return {
            "answer": f"Chat failed: {str(e)}"
        }

# ─────────────────────────────────────────────────────────────
# REPORT
# ─────────────────────────────────────────────────────────────

@app.post("/report")
def generate_report(data: ReportRequest):

    try:

        prompt = f"""
Logs:
{data.logs}

Analysis:
{json.dumps(data.analysis, indent=2)}

Generate professional post-mortem report.
"""

        msg = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1500,
            system=REPORT_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        report_text = msg.content[0].text.strip()

        buf = io.BytesIO(report_text.encode())

        return StreamingResponse(
            buf,
            media_type="text/plain",
            headers={
                "Content-Disposition":
                "attachment; filename=outagex-report.txt"
            }
        )

    except Exception as e:

        buf = io.BytesIO(str(e).encode())

        return StreamingResponse(
            buf,
            media_type="text/plain"
        )