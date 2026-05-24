"""
OutageX AI — Hybrid Signal Extraction Engine
Runs BEFORE the LLM to extract hard signals from raw logs.
This makes the system an engineered pipeline, not just an AI wrapper.
"""
import re
from dataclasses import dataclass, field
from typing import List, Dict, Optional

# ── Known error patterns → structured signals ──────────────────────────────
PATTERNS = [
    # Network / Latency
    (r"timeout[^\d]*(\d+)\s*ms",          "network",   "timeout",           "API/service timeout detected"),
    (r"connection.refused",               "network",   "conn_refused",      "Connection refused — service down or not listening"),
    (r"connection.reset",                 "network",   "conn_reset",        "Connection reset by peer"),
    (r"upstream.timed? out",              "network",   "upstream_timeout",  "Upstream service not responding"),
    (r"latency[^\d]*(\d+)\s*ms",          "network",   "high_latency",      "High latency spike detected"),

    # Database
    (r"connection.pool.exhausted",        "database",  "pool_exhausted",    "DB connection pool full — too many concurrent queries"),
    (r"max.connections.reached",          "database",  "max_conn",          "Database hit max_connections limit"),
    (r"deadlock",                         "database",  "deadlock",          "Database deadlock detected"),
    (r"query.timeout",                    "database",  "query_timeout",     "Slow query causing timeout"),
    (r"too many connections",             "database",  "too_many_conn",     "DB connection saturation"),

    # Memory
    (r"out.?of.?memory|oom",              "memory",    "oom",               "Out-of-Memory condition"),
    (r"heap.usage.at\s*(\d+)%",           "memory",    "heap_pressure",     "JVM heap pressure"),
    (r"memory.limit",                     "memory",    "mem_limit",         "Container memory limit hit"),
    (r"gc.overhead",                      "memory",    "gc_overhead",       "GC overhead — memory thrashing"),

    # Kubernetes / Container
    (r"crashloopbackoff",                 "k8s",       "crash_loop",        "Pod in CrashLoopBackOff — repeated crashes"),
    (r"oomkilled",                        "k8s",       "oom_killed",        "Container OOMKilled by kernel"),
    (r"pod.*(pending|failed|evicted)",    "k8s",       "pod_failure",       "Kubernetes pod scheduling/runtime failure"),
    (r"health.?check.*(fail|unhealthy)",  "k8s",       "health_check_fail", "Health check failing — service not ready"),
    (r"liveness.?probe.fail",             "k8s",       "liveness_fail",     "Liveness probe failure — pod being restarted"),

    # HTTP Errors
    (r"\b5[0-9]{2}\b",                    "http",      "5xx_error",         "HTTP 5xx server error"),
    (r"\b4[0-9]{2}\b",                    "http",      "4xx_error",         "HTTP 4xx client/auth error"),
    (r"error.?rate[^\d]*(\d+)%",          "http",      "error_rate",        "Elevated error rate detected"),

    # Cache
    (r"redis.*oom|cache.*full",           "cache",     "cache_oom",         "Cache out of memory"),
    (r"cache.?miss.?rate",                "cache",     "cache_miss",        "High cache miss rate"),
    (r"eviction",                         "cache",     "cache_eviction",    "Cache evictions — memory pressure"),

    # CPU
    (r"cpu.*(9[0-9]|100)%",              "cpu",       "cpu_critical",      "CPU utilization critical (>90%)"),
    (r"throttl",                          "cpu",       "cpu_throttle",      "CPU throttling active"),
    (r"load.average.*[5-9]\d",            "cpu",       "high_load",         "High system load average"),

    # Deployment / Rollback
    (r"deploy(ment)?.*(fail|error)",      "deploy",    "deploy_fail",       "Deployment failure detected"),
    (r"rollback",                         "deploy",    "rollback",          "Rollback event in logs"),
    (r"image.pull.error|ErrImagePull",    "deploy",    "image_pull_err",    "Container image pull failure"),
]

# Severity weights per signal type
SEVERITY_WEIGHTS = {
    "crash_loop": 10, "oom_killed": 10, "oom": 9, "max_conn": 9,
    "pool_exhausted": 8, "error_rate": 8, "5xx_error": 6,
    "upstream_timeout": 6, "timeout": 5, "conn_refused": 7,
    "deploy_fail": 7, "pod_failure": 7, "health_check_fail": 6,
    "heap_pressure": 5, "gc_overhead": 6, "cpu_critical": 8,
    "deadlock": 9, "cache_oom": 5,
}

@dataclass
class Signal:
    category: str
    code: str
    description: str
    count: int = 1
    raw_matches: List[str] = field(default_factory=list)

@dataclass
class ExtractedSignals:
    signals: List[Signal]
    affected_services: List[str]
    error_counts: Dict[str, int]
    severity_score: int
    suggested_severity: str
    metrics: Dict
    timeline_hints: List[Dict]
    summary_context: str  # injected into LLM prompt


def extract_services(logs: str) -> List[str]:
    """Extract service/component names from log lines."""
    candidates = set()
    patterns = [
        r"service[=:\s]+([a-z][a-z0-9\-_]+)",
        r"container=([a-z][a-z0-9\-_]+)",
        r"([a-z][a-z0-9\-]+(?:-service|-api|-svc|-worker|-proxy|-db))",
        r"upstream[:\s]+([a-z][a-z0-9\-_:]+)",
    ]
    for p in patterns:
        for m in re.finditer(p, logs, re.IGNORECASE):
            svc = m.group(1).lower().strip(":/ ")
            if 3 < len(svc) < 40:
                candidates.add(svc)
    # dedupe substrings
    result = []
    sorted_c = sorted(candidates, key=len, reverse=True)
    for s in sorted_c:
        if not any(s in existing for existing in result):
            result.append(s)
    return result[:8]


def extract_metrics(logs: str) -> Dict:
    """Pull numeric metrics from logs."""
    metrics = {}

    m = re.search(r"error.?rate[^\d]*(\d+(?:\.\d+)?)\s*%", logs, re.I)
    if m: metrics["error_rate_pct"] = float(m.group(1))

    latencies = [float(x) for x in re.findall(r"latency[:\s]*(\d+(?:\.\d+)?)\s*ms", logs, re.I)]
    if latencies: metrics["max_latency_ms"] = max(latencies)

    heap = re.search(r"heap.usage.at\s*(\d+)\s*%", logs, re.I)
    if heap: metrics["heap_pct"] = int(heap.group(1))

    cpu = re.search(r"cpu[^\d]*(\d+(?:\.\d+)?)\s*%", logs, re.I)
    if cpu: metrics["cpu_pct"] = float(cpu.group(1))

    restarts = re.search(r"restarts?[:\s]*(\d+)", logs, re.I)
    if restarts: metrics["pod_restarts"] = int(restarts.group(1))

    pool = re.search(r"pool_size[=:]\s*(\d+).*?waiting[=:]\s*(\d+)", logs, re.I)
    if pool: metrics["pool_size"] = int(pool.group(1)); metrics["pool_waiting"] = int(pool.group(2))

    return metrics


def extract_timeline(logs: str) -> List[Dict]:
    """Pull timestamps + events for timeline."""
    timeline = []
    ts_pattern = re.compile(
        r"(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)"
        r".*?(ERROR|WARN|CRITICAL|FATAL|error|warn|critical)",
        re.IGNORECASE
    )
    seen = set()
    for m in ts_pattern.finditer(logs):
        ts = m.group(1)
        short_ts = ts[11:19] if "T" in ts else ts[11:19]
        line = logs[m.start():m.start()+120].split("\n")[0]
        key = short_ts
        if key not in seen:
            seen.add(key)
            timeline.append({"time": short_ts, "raw_line": line.strip()})
    return timeline[:8]


def score_to_severity(score: int) -> str:
    if score >= 20: return "CRITICAL"
    if score >= 12: return "HIGH"
    if score >= 6:  return "MEDIUM"
    return "LOW"


def extract(logs: str) -> ExtractedSignals:
    logs_lower = logs.lower()
    found: Dict[str, Signal] = {}
    error_counts = {"ERROR": 0, "WARN": 0, "CRITICAL": 0, "FATAL": 0}

    # Count log levels
    for level in error_counts:
        error_counts[level] = len(re.findall(rf"\b{level}\b", logs, re.I))

    # Match patterns
    for pattern, category, code, description in PATTERNS:
        matches = re.findall(pattern, logs_lower)
        if matches:
            if code in found:
                found[code].count += len(matches)
                found[code].raw_matches += [str(m) for m in matches[:2]]
            else:
                found[code] = Signal(category, code, description, len(matches),
                                     [str(m) for m in matches[:2]])

    signals = list(found.values())
    severity_score = sum(SEVERITY_WEIGHTS.get(s.code, 3) * min(s.count, 3) for s in signals)
    # Boost for CRITICAL keyword
    severity_score += error_counts.get("CRITICAL", 0) * 4
    severity_score += error_counts.get("FATAL", 0) * 5

    services = extract_services(logs)
    metrics = extract_metrics(logs)
    timeline = extract_timeline(logs)

    # Build context paragraph for LLM
    signal_lines = [f"- [{s.category.upper()}] {s.description} (seen {s.count}x)" for s in signals]
    metric_lines = [f"- {k}: {v}" for k, v in metrics.items()]
    ctx_parts = ["=== PRE-ANALYZED SIGNALS (use these as hard facts) ==="]
    if signal_lines:
        ctx_parts.append("Detected signals:\n" + "\n".join(signal_lines))
    if metric_lines:
        ctx_parts.append("Extracted metrics:\n" + "\n".join(metric_lines))
    ctx_parts.append(f"Signal severity score: {severity_score}")
    ctx_parts.append(f"Suggested severity: {score_to_severity(severity_score)}")
    ctx_parts.append("=== END PRE-ANALYSIS ===")

    return ExtractedSignals(
        signals=signals,
        affected_services=services,
        error_counts=error_counts,
        severity_score=severity_score,
        suggested_severity=score_to_severity(severity_score),
        metrics=metrics,
        timeline_hints=timeline,
        summary_context="\n".join(ctx_parts),
    )
