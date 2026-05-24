# ⚡ OutageX AI — Autonomous Incident Intelligence Platform

> Real-Time AI-Powered Root Cause Analysis for Distributed Systems  
> Built with Claude AI + FastAPI + React + Vite

---

## 🚀 What It Does

Paste raw logs from any source → OutageX AI detects root cause, severity, affected services, event timeline, one-click fix scripts, financial impact — all in seconds.

### Features
| Feature | Status |
|---|---|
| Hybrid AI engine (deterministic signals + LLM reasoning) | ✅ |
| Multi-source support (Kubernetes, Nginx, CloudWatch, Docker) | ✅ |
| War Room Mode — red alert UI for CRITICAL incidents | ✅ |
| Severity classification with AI reasoning | ✅ |
| Root cause + business impact detection | ✅ |
| Event timeline reconstruction | ✅ |
| One-click fix scripts (kubectl, redis-cli, psql) | ✅ |
| AI confidence scoring + explainability | ✅ |
| Service dependency map (SVG) | ✅ |
| Financial impact calculator | ✅ |
| Live log feed simulation | ✅ |
| AI Chat Assistant (follow-up Q&A) | ✅ |
| One-click PDF incident report export | ✅ |
| Incident history + recurring patterns | ✅ |
| Dashboard with gauges, sparklines, donut chart | ✅ |
| Grafana / Slack integration | 🔜 |

---

## 🏗️ Architecture

```
Raw Logs → Signal Extractor (regex) → Claude AI (reasoning) → JSON Result
                                                                    ↓
                                              React UI (War Room / Chat / Dashboard)
```

**Hybrid Engine:** `signal_extractor.py` runs deterministic regex pattern matching first,
then Claude reasons *over* pre-confirmed signals — not raw logs alone. This means
faster, more accurate, and more reliable analysis.

---

## 📦 Project Structure

```
outagex-ai/
├── backend/
│   ├── main.py              # FastAPI server (analyze / chat / report)
│   ├── signal_extractor.py  # Hybrid deterministic signal engine
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Full React UI
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── docs/
│   ├── architecture.svg
│   ├── sample_logs.txt
│   └── project_pitch.md
├── .env.example
├── start.sh                 # One-command startup script
└── README.md
```

---

## ⚙️ Setup & Run

### Prerequisites
- Python 3.10+
- Node.js 18+
- Anthropic API key → [console.anthropic.com](https://console.anthropic.com)

### 1. Set your API key
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 2. One-command start (Linux/Mac)
```bash
chmod +x start.sh
./start.sh
```

### Or manually:

#### Backend
```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8000
```

#### Frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## 🎮 Demo Flow (for judges)

1. Select **Kubernetes** source
2. Click **Load Sample**
3. Hit ⚡ **Analyze Incident**
4. Watch War Room Mode activate 🚨
5. Switch to **Chat** → ask *"What's the blast radius?"*
6. Click **Dashboard** → see live metrics
7. Click ⬇ **PDF** → download incident report

---

## 🧠 Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, CSS-in-JS |
| Backend | FastAPI, Python 3.10+ |
| AI Engine | Claude (Anthropic API) |
| Signal Extraction | Custom regex pipeline |
| PDF Generation | ReportLab |
| Fonts | Syne + JetBrains Mono |

---

## 👨‍💻 Built for AI Hackathon 2026

*OutageX AI — Because every second of downtime costs money.*
