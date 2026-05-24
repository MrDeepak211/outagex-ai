import { useState, useRef, useEffect, useCallback } from "react";

// ── Google Fonts ──────────────────────────────────────────────────────────────
const FONT_URL = "https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";

// ── Sample logs ───────────────────────────────────────────────────────────────
const SAMPLES = {
  kubernetes: `2024-01-15 03:42:11 ERROR auth-service: Connection pool exhausted (pool_size=50, waiting=127)
2024-01-15 03:42:13 WARN  api-gateway: Upstream timeout after 30000ms - auth-service
2024-01-15 03:42:14 ERROR postgres-primary: Max connections reached (max_connections=100, current=100)
2024-01-15 03:42:15 ERROR api-gateway: 503 Service Unavailable - /api/v2/login [latency: 8420ms]
2024-01-15 03:42:16 CRITICAL k8s: Pod auth-service-7d9f8b-xk2p1 CrashLoopBackOff (restarts: 8)
2024-01-15 03:42:17 ERROR notification-svc: Failed to reach auth-service after 3 retries
2024-01-15 03:42:18 WARN  load-balancer: Health check failed for 3/4 auth-service instances
2024-01-15 03:42:20 ERROR redis-cache: OOM command not allowed - used_memory > maxmemory
2024-01-15 03:42:22 CRITICAL monitoring: Error rate 89% on /api/v2/* (threshold: 5%)`,
  nginx: `2024-01-16 09:10:02 [error] 1234#0: *89 connect() failed (111: Connection refused) upstream
2024-01-16 09:10:03 [warn]  upstream response time 28432ms /api/checkout latency: 28432ms
2024-01-16 09:10:05 [error] recv() failed (104: Connection reset by peer) reading response header
2024-01-16 09:10:06 [error] upstream timed out (110: Connection timed out), client: 10.0.1.45
2024-01-16 09:10:08 [crit]  502 Bad Gateway - /api/checkout [upstream: payment-svc:8080]
2024-01-16 09:10:09 [error] limiting requests, excess: 18.4 error_rate: 73%`,
  cloudwatch: `{"timestamp":"2024-01-17T14:22:01Z","level":"ERROR","service":"lambda-processor","message":"Task timed out after 15000ms","requestId":"abc-123"}
{"timestamp":"2024-01-17T14:22:04Z","level":"CRITICAL","service":"rds-aurora","message":"Failover initiated - primary instance unresponsive","instanceId":"db-prod-01"}
{"timestamp":"2024-01-17T14:22:06Z","level":"ERROR","service":"ec2-worker","message":"CPU utilization 97% - throttling active","instanceId":"i-0a1b2c3d"}
{"timestamp":"2024-01-17T14:22:10Z","level":"WARN","service":"sqs-queue","message":"ApproximateAgeOfOldestMessage: 847s latency: 847000ms","queue":"order-processing"}
{"timestamp":"2024-01-17T14:22:15Z","level":"CRITICAL","service":"alb","message":"Target group unhealthy: 0/3 instances passing health checks error_rate: 100%"}`,
  docker: `2024-01-18T07:55:03.112Z container=payment-api status=OOMKilled exitCode=137 memory_limit=512MB
2024-01-18T07:55:04.441Z container=payment-api restart_count=5 backoff=160s heap usage at 98%
2024-01-18T07:55:05.002Z network=prod-bridge error="connection refused: payment-api:8080"
2024-01-18T07:55:06.789Z container=order-service error="upstream timed out payment-api:8080 latency: 45000ms"
2024-01-18T07:55:08.001Z compose health_check=payment-api status=unhealthy consecutive_failures=5`,
};

const SOURCES = {
  kubernetes: { label: "Kubernetes", icon: "⎈", color: "#326ce5" },
  nginx:      { label: "Nginx",      icon: "◈", color: "#22c55e" },
  cloudwatch: { label: "CloudWatch", icon: "☁", color: "#ff9900" },
  docker:     { label: "Docker",     icon: "▣", color: "#2496ed" },
};

const SEV = {
  LOW:      { color: "#22c55e", glow: "#22c55e44", bg: "rgba(34,197,94,0.07)"  },
  MEDIUM:   { color: "#f59e0b", glow: "#f59e0b44", bg: "rgba(245,158,11,0.07)" },
  HIGH:     { color: "#f97316", glow: "#f97316aa", bg: "rgba(249,115,22,0.07)" },
  CRITICAL: { color: "#ef4444", glow: "#ef444488", bg: "rgba(239,68,68,0.07)"  },
};

const CAT_COLORS = {
  network:"#38bdf8", database:"#f97316", memory:"#a78bfa",
  k8s:"#326ce5", http:"#ef4444", cache:"#f59e0b", cpu:"#fb923c", deploy:"#34d399",
};

// ── Downtime cost calculator ──────────────────────────────────────────────────
// Industry average: $5,600/min for enterprise outages (Gartner)
function calcFinancialImpact(result) {
  if (!result) return null;
  const sev = result.severity;
  const timelineLen = result.timeline?.length || 1;
  // Estimate minutes of outage from timeline span
  const baseMins = { CRITICAL: 18, HIGH: 10, MEDIUM: 5, LOW: 2 }[sev] || 5;
  const estimatedMins = baseMins + timelineLen;
  const costPerMin = { CRITICAL: 5600, HIGH: 3200, MEDIUM: 1400, LOW: 400 }[sev] || 1400;
  const totalCost = estimatedMins * costPerMin;
  const detectionSaving = Math.round(totalCost * 0.87); // 87% saved by AI vs manual
  return {
    estimatedMins,
    costPerMin,
    totalCost,
    detectionSaving,
    formatted: detectionSaving >= 1000
      ? `$${(detectionSaving / 1000).toFixed(1)}K`
      : `$${detectionSaving}`,
  };
}

// ── Fake incident history ─────────────────────────────────────────────────────
const MOCK_HISTORY = [
  { id:1, date:"May 18, 2026", severity:"CRITICAL", cause:"Redis OOM — cache eviction storm",    duration:"23 min", services:["redis-cache","api-gateway"] },
  { id:2, date:"May 12, 2026", severity:"HIGH",     cause:"DB connection pool exhausted",        duration:"11 min", services:["postgres-primary","auth-service"] },
  { id:3, date:"May 05, 2026", severity:"MEDIUM",   cause:"Pod CrashLoopBackOff after deploy",  duration:"6 min",  services:["payment-api"] },
  { id:4, date:"Apr 28, 2026", severity:"HIGH",     cause:"CPU throttling — ec2 worker fleet",  duration:"18 min", services:["ec2-worker","sqs-queue"] },
];

// ── Mock metrics ──────────────────────────────────────────────────────────────
function buildMockMetrics(m) {
  const cpu       = m?.cpu_pct       || 34;
  const memory    = m?.heap_pct      || 52;
  const latency   = m?.max_latency_ms ? Math.min(m.max_latency_ms / 100, 99) : 28;
  const errorRate = m?.error_rate_pct || 4;
  const spark = (base, variance, count = 16) =>
    Array.from({ length: count }, (_, i) =>
      Math.max(0, Math.min(100, base + Math.sin(i * 0.8) * variance + Math.random() * variance * 0.5)));
  return { cpu, memory, latency, errorRate,
    cpuSpark: spark(cpu, 15), memorySpark: spark(memory, 10),
    latencySpark: spark(latency, 20), errorSpark: spark(errorRate, 8) };
}

// ── Fix script generator ──────────────────────────────────────────────────────
function genFixScripts(result) {
  const services = result?.affected_services || [];
  const signals  = result?._signals || [];
  const scripts  = [];
  if (signals.some(s => s.code === "crash_loop"))
    services.forEach(svc => scripts.push({ label: `Restart ${svc}`, cmd: `kubectl rollout restart deployment/${svc}` }));
  if (signals.some(s => s.code === "oom_killed" || s.code === "oom"))
    scripts.push({ label: "Scale memory limit", cmd: `kubectl set resources deployment/${services[0] || "app"} --limits=memory=1Gi` });
  if (signals.some(s => s.code === "pool_exhausted" || s.code === "max_conn"))
    scripts.push({ label: "Reset DB pool", cmd: `psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle';"` });
  if (signals.some(s => s.code === "cache_oom"))
    scripts.push({ label: "Flush Redis cache", cmd: `redis-cli FLUSHDB` });
  if (signals.some(s => s.code === "cpu_critical"))
    scripts.push({ label: "Scale up pods", cmd: `kubectl scale deployment/${services[0] || "app"} --replicas=5` });
  if (signals.some(s => s.code === "deploy_fail"))
    scripts.push({ label: "Rollback deployment", cmd: `kubectl rollout undo deployment/${services[0] || "app"}` });
  if (scripts.length === 0)
    scripts.push({ label: "Check pod status", cmd: `kubectl get pods --all-namespaces | grep -v Running` });
  return scripts;
}

// ── AI Agents config ──────────────────────────────────────────────────────────
const AGENTS = [
  { id:"log",      name:"Log Analysis",  icon:"🔍", desc:"Parses raw logs, extracts signal patterns", color:"#38bdf8" },
  { id:"root",     name:"Root Cause",    icon:"🧠", desc:"Correlates signals, infers failure origin",  color:"#a78bfa" },
  { id:"security", name:"Security",      icon:"🛡️", desc:"Scans for brute force, DDoS, auth spikes",   color:"#ef4444" },
  { id:"recovery", name:"Recovery",      icon:"⚙️", desc:"Generates kubectl/docker fix commands",      color:"#22c55e" },
  { id:"report",   name:"Report",        icon:"📋", desc:"Writes post-mortem, exports PDF",            color:"#f59e0b" },
];

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 120, height = 32 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const fillPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{ display:"block" }}>
      <defs>
        <linearGradient id={`sg-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#sg-${color.slice(1)})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── Gauge ─────────────────────────────────────────────────────────────────────
function Gauge({ value, color, label }) {
  const pct = Math.min(value, 100);
  const r = 28, cx = 36, cy = 36;
  const circ = Math.PI * r;
  const dash = (pct / 100) * circ;
  const isHot = pct > 70;
  return (
    <div style={{ textAlign:"center" }}>
      <svg width={72} height={48} style={{ overflow:"visible" }}>
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
          fill="none" stroke="#1e2736" strokeWidth="6" strokeLinecap="round"/>
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
          fill="none" stroke={isHot ? "#ef4444" : color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ filter: isHot ? `drop-shadow(0 0 6px #ef4444)` : `drop-shadow(0 0 4px ${color})` }}/>
        <text x={cx} y={cy - 4} textAnchor="middle" fill={isHot ? "#ef4444" : color}
          fontSize="11" fontWeight="700" fontFamily="'JetBrains Mono',monospace">{pct}%</text>
      </svg>
      <div style={{ fontSize:9, color:"#64748b", letterSpacing:1, marginTop:-4 }}>{label}</div>
    </div>
  );
}

// ── Service Dependency Map ────────────────────────────────────────────────────
function ServiceMap({ result }) {
  const affected = new Set((result?.affected_services || []).map(s => s.toLowerCase()));
  const nodes = [
    { id:"gateway",  label:"API Gateway",   x:200, y:40,  color:"#38bdf8" },
    { id:"auth",     label:"Auth Service",  x:80,  y:130, color:"#a78bfa" },
    { id:"payment",  label:"Payment API",   x:200, y:130, color:"#f97316" },
    { id:"notify",   label:"Notif. Svc",    x:320, y:130, color:"#38bdf8" },
    { id:"postgres", label:"Postgres DB",   x:80,  y:220, color:"#f97316" },
    { id:"redis",    label:"Redis Cache",   x:200, y:220, color:"#ef4444" },
    { id:"k8s",      label:"K8s Cluster",   x:320, y:220, color:"#326ce5" },
  ];
  const edges = [
    ["gateway","auth"],["gateway","payment"],["gateway","notify"],
    ["auth","postgres"],["auth","redis"],["payment","postgres"],["notify","redis"],["payment","k8s"],
  ];
  const isFailed = (id) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return false;
    return [...affected].some(a => node.label.toLowerCase().includes(a) || a.includes(id));
  };
  return (
    <svg viewBox="0 0 400 270" width="100%" style={{ maxHeight:240 }}>
      {edges.map(([a,b], i) => {
        const n1 = nodes.find(n => n.id === a), n2 = nodes.find(n => n.id === b);
        const failed = isFailed(a) || isFailed(b);
        return (
          <line key={i} x1={n1.x} y1={n1.y} x2={n2.x} y2={n2.y}
            stroke={failed ? "#ef444455" : "#1e2736"} strokeWidth={failed ? 1.5 : 1}
            strokeDasharray={failed ? "4 3" : "none"}/>
        );
      })}
      {nodes.map(node => {
        const failed = isFailed(node.id);
        return (
          <g key={node.id}>
            {failed && <circle cx={node.x} cy={node.y} r={22} fill="#ef444411"
              style={{ animation:"pulse 1.5s ease-in-out infinite" }}/>}
            <circle cx={node.x} cy={node.y} r={16}
              fill={failed ? "#1a0303" : "#0f1623"}
              stroke={failed ? "#ef4444" : node.color}
              strokeWidth={failed ? 2 : 1}
              style={{ filter: failed ? "drop-shadow(0 0 8px #ef4444)" : `drop-shadow(0 0 4px ${node.color}66)` }}/>
            <text x={node.x} y={node.y + 4} textAnchor="middle"
              fill={failed ? "#ef4444" : node.color}
              fontSize="8" fontFamily="'JetBrains Mono',monospace" fontWeight="600">
              {failed ? "✕" : "●"}
            </text>
            <text x={node.x} y={node.y + 28} textAnchor="middle"
              fill={failed ? "#ef4444" : "#64748b"} fontSize="8"
              fontFamily="'JetBrains Mono',monospace">{node.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ label, pct, color }) {
  const [w, setW] = useState(0);
  useEffect(() => { setTimeout(() => setW(pct), 100 + Math.random() * 300); }, [pct]);
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#94a3b8" }}>{label}</span>
        <span style={{ fontSize:11, color, fontWeight:700 }}>{pct}%</span>
      </div>
      <div style={{ height:4, background:"#1e2736", borderRadius:4 }}>
        <div style={{ height:"100%", width:`${w}%`, borderRadius:4, background:color,
          boxShadow:`0 0 8px ${color}88`, transition:"width 1.2s cubic-bezier(.4,0,.2,1)" }}/>
      </div>
    </div>
  );
}

// ── Incident frequency bar chart ──────────────────────────────────────────────
function FreqChart() {
  const data = [2,1,4,1,3,5,2,3,1,6,2,4,1,3,2];
  const max = Math.max(...data);
  const days = ["11","12","13","14","15","16","17","18","19","20","21","22","23","24","25"];
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:48 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
          <div style={{
            width:"100%", height:`${(v/max)*40}px`,
            background: v >= 5 ? "#ef4444" : v >= 3 ? "#f97316" : "#38bdf8",
            borderRadius:"2px 2px 0 0",
            opacity: i === data.length-1 ? 1 : 0.6,
            boxShadow: v >= 5 ? "0 0 6px #ef444488" : "none",
            transition:"height .6s ease",
          }}/>
          {i % 4 === 0 && <span style={{ fontSize:7, color:"#475569" }}>May {days[i]}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Severity donut ────────────────────────────────────────────────────────────
function SeverityDonut() {
  const slices = [
    { label:"CRITICAL", count:3, color:"#ef4444", pct:20 },
    { label:"HIGH",     count:5, color:"#f97316", pct:33 },
    { label:"MEDIUM",   count:4, color:"#f59e0b", pct:27 },
    { label:"LOW",      count:3, color:"#22c55e", pct:20 },
  ];
  let cum = 0;
  const r = 28, cx = 36, cy = 36, circ = 2 * Math.PI * r;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
      <svg width={72} height={72}>
        {slices.map((s, i) => {
          const dash = (s.pct / 100) * circ;
          const offset = -((cum / 100) * circ) + circ * 0.25;
          cum += s.pct;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth="10"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={offset}
              style={{ filter:`drop-shadow(0 0 4px ${s.color}66)` }}/>
          );
        })}
        <circle cx={cx} cy={cy} r={18} fill="#080e18"/>
        <text x={cx} y={cy+4} textAnchor="middle" fill="#e2e8f0"
          fontSize="9" fontWeight="700" fontFamily="'JetBrains Mono',monospace">15</text>
      </svg>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {slices.map(s => (
          <div key={s.label} style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:s.color,
              boxShadow:`0 0 4px ${s.color}` }}/>
            <span style={{ fontSize:9, color:"#64748b", letterSpacing:.5 }}>{s.label}</span>
            <span style={{ fontSize:9, color:s.color, fontWeight:700, marginLeft:"auto" }}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agent status pill ─────────────────────────────────────────────────────────
function AgentPill({ agent, active, done }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
      background: done ? `rgba(${agent.color === "#22c55e" ? "34,197,94" : "56,189,248"},0.06)` : "rgba(255,255,255,0.02)",
      border:`1px solid ${done ? agent.color + "44" : "#1e2736"}`,
      borderRadius:8, transition:"all .4s ease",
      boxShadow: done ? `0 0 12px ${agent.color}22` : "none",
    }}>
      <div style={{
        width:28, height:28, borderRadius:7,
        background: done ? agent.color + "22" : "#1e2736",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:14, border:`1px solid ${done ? agent.color + "44" : "#2d3748"}`,
      }}>{agent.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:11, color: done ? "#e2e8f0" : "#475569", fontWeight:600 }}>{agent.name}</div>
        <div style={{ fontSize:9, color:"#334155", marginTop:2 }}>{agent.desc}</div>
      </div>
      <div style={{
        width:7, height:7, borderRadius:"50%",
        background: active ? "#f59e0b" : done ? agent.color : "#1e2736",
        boxShadow: active ? "0 0 8px #f59e0b" : done ? `0 0 6px ${agent.color}` : "none",
        animation: active ? "pulse 1s ease-in-out infinite" : "none",
      }}/>
    </div>
  );
}

// ── FEATURE 2: Streaming typewriter text ──────────────────────────────────────
function TypewriterText({ text, speed = 18, color = "#cbd5e1" }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed("");
    setDone(false);
    if (!text) return;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(iv); setDone(true); }
    }, speed);
    return () => clearInterval(iv);
  }, [text, speed]);
  return (
    <span style={{ color }}>
      {displayed}
      {!done && <span style={{ animation:"blink .7s step-start infinite", color:"#38bdf8" }}>▌</span>}
    </span>
  );
}

// ── FEATURE 5: Mini Architecture Pipeline ─────────────────────────────────────
function ArchPipeline({ active }) {
  const steps = [
    { label: "Raw Logs",        icon: "📄", color: "#64748b" },
    { label: "Signal Extract",  icon: "🔬", color: "#38bdf8" },
    { label: "AI Agents",       icon: "🤖", color: "#a78bfa" },
    { label: "Root Cause",      icon: "🧠", color: "#f97316" },
    { label: "Recovery Plan",   icon: "⚙️", color: "#22c55e" },
  ];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:0, padding:"14px 16px",
      background:"rgba(0,0,0,0.2)", borderRadius:8, overflowX:"auto" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:0, flexShrink:0 }}>
          <div style={{
            display:"flex", flexDirection:"column", alignItems:"center", gap:5,
            padding:"8px 14px",
            background: active ? `${s.color}11` : "transparent",
            border: `1px solid ${active ? s.color + "44" : "#1e2736"}`,
            borderRadius:8, minWidth:90,
            transition:"all .4s ease",
            boxShadow: active ? `0 0 14px ${s.color}22` : "none",
          }}>
            <span style={{ fontSize:20 }}>{s.icon}</span>
            <span style={{ fontSize:9, color: active ? s.color : "#334155",
              letterSpacing:.5, textAlign:"center", fontWeight:600 }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ display:"flex", alignItems:"center", padding:"0 4px" }}>
              <div style={{ height:1, width:20, background: active ? "#38bdf844" : "#1e2736" }}/>
              <span style={{ fontSize:10, color: active ? "#38bdf8" : "#1e2736" }}>▶</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── FEATURE 1: War Room alert overlay ─────────────────────────────────────────
function WarRoomOverlay({ severity, onDismiss }) {
  const isCritical = severity === "CRITICAL";
  const isHigh = severity === "HIGH";
  if (!isCritical && !isHigh) return null;
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:500, pointerEvents:"none",
      animation: isCritical ? "warRoomPulse 1.2s ease-in-out 3" : "none",
    }}>
      {/* Red vignette border pulse */}
      <div style={{
        position:"absolute", inset:0,
        boxShadow: isCritical
          ? "inset 0 0 80px #ef444466, inset 0 0 160px #ef444422"
          : "inset 0 0 60px #f9731644",
        animation: isCritical ? "warRoomGlow 1.2s ease-in-out 4" : "none",
        pointerEvents:"none",
      }}/>
      {/* Top alert bar */}
      <div style={{
        position:"absolute", top:60, left:"50%", transform:"translateX(-50%)",
        background: isCritical ? "rgba(239,68,68,0.95)" : "rgba(249,115,22,0.9)",
        backdropFilter:"blur(12px)",
        border:`1px solid ${isCritical ? "#ef4444" : "#f97316"}`,
        borderRadius:10, padding:"12px 28px",
        display:"flex", alignItems:"center", gap:14,
        boxShadow: `0 0 40px ${isCritical ? "#ef444499" : "#f9731666"}`,
        pointerEvents:"all",
        animation:"warRoomDrop .4s cubic-bezier(.2,1.4,.5,1) forwards",
      }}>
        {/* Siren icon */}
        <div style={{
          fontSize:24,
          animation:"sirenSpin 0.5s linear infinite",
          display:"inline-block",
        }}>🚨</div>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:"#fff", letterSpacing:1,
            fontFamily:"'Syne',sans-serif" }}>
            {isCritical ? "⚡ CRITICAL INCIDENT DETECTED" : "▲ HIGH SEVERITY INCIDENT"}
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.8)", letterSpacing:1, marginTop:2 }}>
            WAR ROOM MODE ACTIVE — AI AGENTS MOBILIZED
          </div>
        </div>
        <button onClick={onDismiss} style={{
          background:"rgba(0,0,0,0.3)", border:"1px solid rgba(255,255,255,0.3)",
          color:"#fff", borderRadius:6, padding:"4px 12px",
          fontSize:11, fontWeight:700, cursor:"pointer", marginLeft:8,
        }}>DISMISS</button>
      </div>
    </div>
  );
}

// ── FEATURE 3: Premium landing hero ──────────────────────────────────────────
function LandingHero() {
  return (
    <div style={{ textAlign:"center", padding:"40px 20px 32px", position:"relative" }}>
      {/* Background glow */}
      <div style={{
        position:"absolute", top:"50%", left:"50%",
        transform:"translate(-50%, -50%)",
        width:500, height:200,
        background:"radial-gradient(ellipse, #38bdf811 0%, transparent 70%)",
        pointerEvents:"none",
        animation:"heroGlow 4s ease-in-out infinite",
      }}/>
      <div style={{ position:"relative" }}>
        <div style={{ fontSize:11, color:"#38bdf8", letterSpacing:4,
          marginBottom:12, fontWeight:600,
          animation:"fadeUp .5s ease forwards" }}>
          ◈ ENTERPRISE RELIABILITY ENGINEERING ◈
        </div>
        <h1 style={{
          fontFamily:"'Syne',sans-serif", fontWeight:800,
          fontSize:38, lineHeight:1.15, color:"#f1f5f9",
          marginBottom:10, letterSpacing:-1,
          animation:"fadeUp .5s .1s ease both",
        }}>
          Autonomous{" "}
          <span style={{
            color:"#ef4444",
            textShadow:"0 0 30px #ef444488, 0 0 60px #ef444433",
            animation:"titleGlow 2.5s ease-in-out infinite",
          }}>Incident</span>
          {" "}Intelligence
        </h1>
        <p style={{
          fontSize:14, color:"#475569", maxWidth:500,
          margin:"0 auto 16px", lineHeight:1.7,
          animation:"fadeUp .5s .2s ease both",
        }}>
          Powered by Hybrid AI Agents · Signal Extraction + LLM Reasoning · Real-time Root Cause Analysis
        </p>
        <div style={{
          display:"inline-flex", alignItems:"center", gap:8,
          background:"rgba(56,189,248,0.05)",
          border:"1px solid rgba(56,189,248,0.15)", borderRadius:20,
          padding:"6px 18px", fontSize:10, color:"#38bdf8", letterSpacing:2,
          animation:"fadeUp .5s .3s ease both, heroGlow 3s 1s ease-in-out infinite",
        }}>
          <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%",
            background:"#22c55e", boxShadow:"0 0 8px #22c55e",
            animation:"pulse 1.5s ease infinite" }}/>
          HYBRID AI ENGINE v3 · ONLINE
        </div>
      </div>
    </div>
  );
}

// ── FEATURE 4: Financial impact KPI ──────────────────────────────────────────
function FinancialKPI({ impact }) {
  const [shown, setShown] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!impact) return;
    setShown(false);
    setTimeout(() => {
      setShown(true);
      // Count-up animation
      const target = impact.detectionSaving;
      const duration = 1800;
      const steps = 50;
      const inc = target / steps;
      let cur = 0;
      const iv = setInterval(() => {
        cur += inc;
        if (cur >= target) { setCount(target); clearInterval(iv); }
        else setCount(Math.round(cur));
      }, duration / steps);
    }, 600);
  }, [impact]);

  if (!impact) return null;
  const formatted = count >= 1000 ? `$${(count / 1000).toFixed(1)}K` : `$${count}`;

  return (
    <div style={{
      background: shown ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)",
      border:`1px solid ${shown ? "rgba(34,197,94,0.3)" : "#1e2736"}`,
      borderRadius:10, padding:"14px 16px",
      backdropFilter:"blur(12px)",
      boxShadow: shown ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 24px rgba(34,197,94,0.15)" : "none",
      transition:"all .6s ease",
    }}>
      <div style={{ fontSize:8, color:"#475569", letterSpacing:2, marginBottom:6 }}>
        ESTIMATED DOWNTIME COST PREVENTED
      </div>
      <div style={{
        fontSize:26, fontWeight:800, color:"#22c55e",
        fontFamily:"'Syne',sans-serif",
        textShadow: shown ? "0 0 24px #22c55e66" : "none",
        transition:"text-shadow .6s ease",
      }}>
        {formatted}
      </div>
      <div style={{ fontSize:9, color:"#334155", marginTop:4 }}>
        vs. manual detection · ~{impact.estimatedMins}min outage at ${impact.costPerMin.toLocaleString()}/min
      </div>
    </div>
  );
}

// ── KPI strip (upgraded with financial KPI slot) ─────────────────────────────
function KPIStrip({ result, impact }) {
  const conf = result?.confidence || null;
  const kpis = [
    { label:"MEAN TIME TO DETECT",  value:"2.4s",  sub:"vs 45min manual", color:"#38bdf8" },
    { label:"INCIDENTS THIS MONTH", value:"15",    sub:"↓ 23% vs last mo", color:"#a78bfa" },
    { label:"AI CONFIDENCE",        value: conf ? `${conf}%` : "—", sub:"hybrid engine", color:"#22c55e" },
    { label:"DOWNTIME SAVED",       value:"4.2 hr", sub:"est. this week",  color:"#f59e0b" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns: impact ? "repeat(4,1fr) 1.2fr" : "repeat(4,1fr)", gap:12, marginBottom:20 }}>
      {kpis.map(k => (
        <div key={k.label} style={{
          background:"rgba(255,255,255,0.02)", border:"1px solid #1e2736",
          borderRadius:10, padding:"14px 16px",
          backdropFilter:"blur(12px)",
          boxShadow:`inset 0 1px 0 rgba(255,255,255,0.05)`,
        }}>
          <div style={{ fontSize:8, color:"#475569", letterSpacing:2, marginBottom:6 }}>{k.label}</div>
          <div style={{ fontSize:22, fontWeight:800, color:k.color, fontFamily:"'Syne',sans-serif",
            textShadow:`0 0 20px ${k.color}66` }}>{k.value}</div>
          <div style={{ fontSize:9, color:"#334155", marginTop:4 }}>{k.sub}</div>
        </div>
      ))}
      {impact && <FinancialKPI impact={impact} />}
    </div>
  );
}

// ── STATUS BAR (War Room indicator) ──────────────────────────────────────────
function StatusBar({ severity, warRoom }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"6px 16px", marginBottom:16, borderRadius:7,
      background: warRoom ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.04)",
      border: `1px solid ${warRoom ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.15)"}`,
      transition:"all .5s ease",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{
          width:7, height:7, borderRadius:"50%",
          background: warRoom ? "#ef4444" : "#22c55e",
          boxShadow: warRoom ? "0 0 10px #ef4444" : "0 0 6px #22c55e",
          animation: warRoom ? "pulse .8s ease-in-out infinite" : "pulse 2s ease-in-out infinite",
        }}/>
        <span style={{ fontSize:10, color: warRoom ? "#ef4444" : "#22c55e",
          fontWeight:700, letterSpacing:2 }}>
          {warRoom ? `⚡ INCIDENT ACTIVE — ${severity}` : "SYSTEM OPERATIONAL"}
        </span>
      </div>
      <div style={{ fontSize:9, color:"#334155", letterSpacing:1 }}>
        {new Date().toLocaleTimeString()} UTC · OutageX AI Hybrid Engine v3
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]                   = useState("analyze");
  const [source, setSource]             = useState("kubernetes");
  const [logs, setLogs]                 = useState("");
  const [result, setResult]             = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [chatHistory, setChatHistory]   = useState([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [agentStep, setAgentStep]       = useState(-1);
  const [copiedIdx, setCopiedIdx]       = useState(null);
  const [liveMode, setLiveMode]         = useState(false);
  const [liveLog, setLiveLog]           = useState([]);
  const [warRoom, setWarRoom]           = useState(false);     // FEATURE 1
  const [warRoomDismissed, setWarRoomDismissed] = useState(false);
  const [streamingText, setStreamingText] = useState({});      // FEATURE 2
  const chatEndRef = useRef(null);
  const liveRef    = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatHistory]);

  // Simulate live log feed
  useEffect(() => {
    if (!liveMode) return;
    const lines = SAMPLES[source].split("\n");
    let i = 0;
    const iv = setInterval(() => {
      if (i < lines.length) { setLiveLog(prev => [...prev.slice(-20), lines[i++]]); }
      else { i = 0; }
    }, 900);
    return () => clearInterval(iv);
  }, [liveMode, source]);

  useEffect(() => { liveRef.current?.scrollTo(0, liveRef.current.scrollHeight); }, [liveLog]);

  // FEATURE 1: Trigger War Room when CRITICAL/HIGH result arrives
  useEffect(() => {
    if (result && (result.severity === "CRITICAL" || result.severity === "HIGH")) {
      setWarRoom(true);
      setWarRoomDismissed(false);
      // Auto-dismiss after 6s
      const t = setTimeout(() => setWarRoom(false), 6000);
      return () => clearTimeout(t);
    } else {
      setWarRoom(false);
    }
  }, [result]);

  const runAgents = useCallback(async () => {
    for (let i = 0; i < AGENTS.length; i++) {
      setAgentStep(i);
      await new Promise(r => setTimeout(r, 380 + Math.random() * 200));
    }
    setAgentStep(AGENTS.length);
  }, []);

  const analyze = async () => {
    if (!logs.trim()) return;
    setLoading(true); setError(null); setResult(null);
    setChatHistory([]); setAgentStep(0); setStreamingText({});
    runAgents();
    try {
      const res = await fetch("/analyze", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ logs, source }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResult(data);
      // FEATURE 2: Mark fields for streaming render
      setStreamingText({ root_cause: true, summary: true, severity_reason: true });
    } catch (e) { setError(e.message); setAgentStep(-1); }
    finally { setLoading(false); }
  };

  // FEATURE 2: Streaming chat response (character by character)
  const sendChat = async () => {
    if (!chatInput.trim() || !result) return;
    const q = chatInput.trim(); setChatInput("");
    const hist = [...chatHistory, { role:"user", content:q }];
    setChatHistory(hist); setChatLoading(true);
    try {
      const res = await fetch("/chat", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ logs, analysis:result, history:hist, question:q }),
      });
      const d = await res.json();
      // Stream the response in character by character
      const answer = d.answer;
      let i = 0;
      setChatHistory([...hist, { role:"assistant", content:"", streaming:true }]);
      const iv = setInterval(() => {
        i++;
        setChatHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role:"assistant", content:answer.slice(0, i), streaming: i < answer.length };
          return updated;
        });
        if (i >= answer.length) clearInterval(iv);
      }, 14);
    } catch {
      setChatHistory([...hist, { role:"assistant", content:"⚠ Backend unreachable.", streaming:false }]);
    } finally { setChatLoading(false); }
  };

  const exportPDF = async () => {
    if (!result) return;
    const res = await fetch("/report", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ logs, analysis:result, source }),
    });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "outagex-incident-report.pdf"; a.click();
  };

  const copyScript = (cmd, idx) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1800);
  };

  const cfg      = result ? (SEV[result.severity] || SEV.MEDIUM) : null;
  const signals  = result?._signals || [];
  const metrics  = result ? buildMockMetrics(result._metrics) : null;
  const fixes    = result ? genFixScripts(result) : [];
  const srcMeta  = SOURCES[source];
  const impact   = calcFinancialImpact(result);   // FEATURE 4
  const isWarRoom = warRoom && !warRoomDismissed;  // FEATURE 1

  const explainSignals = result ? [
    { label:"Signal pattern match", pct: Math.min(95, 60 + signals.length * 5), color:"#38bdf8" },
    { label:"Error cascade detected", pct: result._severity_score > 15 ? 88 : 62, color:"#a78bfa" },
    { label:"Timeline correlation", pct: (result.timeline?.length || 0) > 3 ? 83 : 55, color:"#f97316" },
    { label:"Service blast radius", pct: Math.min(95, 50 + (result.affected_services?.length || 0) * 10), color:"#22c55e" },
  ] : [];

  return (
    <div style={{
      minHeight:"100vh",
      background: isWarRoom ? "#0a0305" : "#060c17",
      color:"#cbd5e1",
      fontFamily:"'JetBrains Mono','Fira Code',monospace",
      transition:"background 1s ease",
    }}>
      <style>{`
        @import url('${FONT_URL}');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(200%)}}
        @keyframes heroGlow{0%,100%{opacity:.6}50%{opacity:1}}
        @keyframes titleGlow{0%,100%{text-shadow:0 0 30px #ef444488,0 0 60px #ef444433}50%{text-shadow:0 0 50px #ef4444bb,0 0 100px #ef444455}}
        @keyframes warRoomPulse{0%,100%{background:#060c17}50%{background:#0d0305}}
        @keyframes warRoomGlow{0%,100%{opacity:0}30%,70%{opacity:1}}
        @keyframes warRoomDrop{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes sirenSpin{0%{transform:rotate(-15deg)}50%{transform:rotate(15deg)}100%{transform:rotate(-15deg)}}
        @keyframes agentActivate{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
        .fadeUp{animation:fadeUp .4s ease forwards}
        .fadeUp2{animation:fadeUp .4s .1s ease both}
        .fadeUp3{animation:fadeUp .4s .2s ease both}
        button:hover:not(:disabled){filter:brightness(1.15);transform:translateY(-1px)}
        button:disabled{opacity:.35;cursor:not-allowed}
        button{transition:all .15s ease;cursor:pointer}
        textarea:focus,input:focus{outline:none!important}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#060c17}
        ::-webkit-scrollbar-thumb{background:#1e2736;border-radius:3px}
        .glass{
          background:rgba(255,255,255,0.025);
          backdrop-filter:blur(16px);
          border:1px solid rgba(255,255,255,0.07);
          box-shadow:0 4px 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.05)
        }
        .war-room-bg{
          box-shadow: inset 0 0 120px rgba(239,68,68,0.08) !important;
        }
        .live-line{animation:fadeUp .2s ease forwards}
      `}</style>

      {/* FEATURE 1: War Room overlay */}
      {isWarRoom && (
        <WarRoomOverlay
          severity={result?.severity}
          onDismiss={() => setWarRoomDismissed(true)}
        />
      )}

      {/* Scanline overlay */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:200, overflow:"hidden",
        opacity: isWarRoom ? .06 : .025 }}>
        <div style={{
          width:"100%", height:80,
          background:`linear-gradient(transparent,rgba(${isWarRoom ? "239,68,68" : "56,189,248"},0.8),transparent)`,
          animation:"scanline 6s linear infinite",
        }}/>
      </div>

      {/* ── Header ── */}
      <header style={{
        position:"sticky", top:0, zIndex:100,
        background: isWarRoom
          ? "rgba(15,4,4,0.92)"
          : "rgba(6,12,23,0.85)",
        backdropFilter:"blur(20px)",
        borderBottom:`1px solid ${isWarRoom ? "rgba(239,68,68,0.25)" : "rgba(56,189,248,0.1)"}`,
        padding:"12px 28px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        transition:"all .5s ease",
      }}>
        {/* FEATURE 3: Premium logo + subtitle */}
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{
            width:38, height:38, borderRadius:10,
            background:"linear-gradient(135deg,#ef4444,#f97316)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:20,
            boxShadow: isWarRoom
              ? "0 0 30px #ef4444, 0 0 60px #ef444466"
              : "0 0 20px #ef444488",
            animation: isWarRoom ? "pulse .8s ease-in-out infinite" : "none",
          }}>⚡</div>
          <div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18,
              color:"#f1f5f9", letterSpacing:-0.5,
              textShadow: isWarRoom ? "0 0 20px #ef444466" : "none" }}>
              OutageX <span style={{ color: isWarRoom ? "#ef4444" : "#38bdf8" }}>AI</span>
            </div>
            <div style={{ fontSize:8, color: isWarRoom ? "#7f1d1d" : "#334155", letterSpacing:2 }}>
              AUTONOMOUS INCIDENT INTELLIGENCE PLATFORM
            </div>
          </div>
          <div style={{
            fontSize:9, letterSpacing:2,
            color: isWarRoom ? "#ef4444" : "#38bdf8",
            background: isWarRoom ? "rgba(239,68,68,0.1)" : "rgba(56,189,248,0.08)",
            border:`1px solid ${isWarRoom ? "rgba(239,68,68,0.4)" : "rgba(56,189,248,0.2)"}`,
            borderRadius:4, padding:"3px 9px",
            animation: isWarRoom ? "pulse .8s ease-in-out infinite" : "none",
          }}>
            {isWarRoom ? "⚡ WAR ROOM ACTIVE" : "HYBRID AI v3"}
          </div>
        </div>

        <nav style={{ display:"flex", gap:6, alignItems:"center" }}>
          {["analyze","dashboard","chat","history"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? "rgba(56,189,248,0.1)" : "transparent",
              border:`1px solid ${tab === t ? "rgba(56,189,248,0.35)" : "rgba(255,255,255,0.06)"}`,
              color: tab === t ? "#38bdf8" : "#475569",
              borderRadius:6, padding:"5px 13px", fontSize:10,
              fontWeight:700, letterSpacing:1,
            }}>{t.toUpperCase()}</button>
          ))}
          {result && (
            <button onClick={exportPDF} style={{
              background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.25)",
              color:"#22c55e", borderRadius:6, padding:"5px 13px",
              fontSize:10, fontWeight:700, letterSpacing:1,
            }}>⬇ PDF</button>
          )}
        </nav>
      </header>

      <main style={{ maxWidth:1240, margin:"0 auto", padding:"24px 20px 80px" }}>

        {/* ══════════════════ ANALYZE TAB ══════════════════ */}
        {tab === "analyze" && (
          <>
            {/* FEATURE 3: Hero only when no result */}
            {!result && !loading && <LandingHero />}

            {/* Status bar */}
            <StatusBar severity={result?.severity} warRoom={isWarRoom} />

            <KPIStrip result={result} impact={impact} />

            {/* FEATURE 5: Architecture pipeline */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:9, color:"#334155", letterSpacing:2, marginBottom:8 }}>
                ◈ AI PIPELINE ARCHITECTURE
              </div>
              <ArchPipeline active={!!result || loading} />
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:16 }}>

              {/* LEFT — Input + Results */}
              <div>
                {/* Source selector */}
                <div style={{ display:"flex", gap:7, marginBottom:14, alignItems:"center" }}>
                  {Object.entries(SOURCES).map(([k, s]) => (
                    <button key={k} onClick={() => setSource(k)} style={{
                      background: source === k ? `rgba(${k==="kubernetes"?"50,108,229":k==="nginx"?"34,197,94":k==="cloudwatch"?"255,153,0":"36,150,237"},0.1)` : "rgba(255,255,255,0.02)",
                      border:`1px solid ${source === k ? s.color + "55" : "rgba(255,255,255,0.06)"}`,
                      color: source === k ? s.color : "#475569",
                      borderRadius:7, padding:"6px 15px", fontSize:11, fontWeight:700,
                      boxShadow: source === k ? `0 0 12px ${s.color}22` : "none",
                    }}>{s.icon} {s.label}</button>
                  ))}
                  <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
                    <button onClick={() => { setLiveMode(!liveMode); if(!liveMode) setLiveLog([]); }} style={{
                      background: liveMode ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.02)",
                      border:`1px solid ${liveMode ? "#ef444455" : "rgba(255,255,255,0.06)"}`,
                      color: liveMode ? "#ef4444" : "#475569",
                      borderRadius:7, padding:"6px 14px", fontSize:10, fontWeight:700, letterSpacing:1,
                    }}>
                      <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%",
                        background: liveMode ? "#ef4444" : "#334155",
                        boxShadow: liveMode ? "0 0 8px #ef4444" : "none",
                        marginRight:6, verticalAlign:"middle",
                        animation: liveMode ? "pulse 1s ease infinite" : "none" }}/>
                      {liveMode ? "LIVE ON" : "LIVE OFF"}
                    </button>
                  </div>
                </div>

                {/* Live feed or paste area */}
                {liveMode ? (
                  <div className="glass" style={{ borderRadius:10, padding:16, marginBottom:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10, alignItems:"center" }}>
                      <span style={{ fontSize:9, color:"#ef4444", letterSpacing:2 }}>
                        ● LIVE LOG STREAM — {srcMeta.label.toUpperCase()}
                      </span>
                      <button onClick={() => { setLogs(liveLog.join("\n")); setLiveMode(false); }} style={{
                        background:"rgba(56,189,248,0.1)", border:"1px solid rgba(56,189,248,0.25)",
                        color:"#38bdf8", borderRadius:5, padding:"3px 11px", fontSize:10, fontWeight:700,
                      }}>CAPTURE & ANALYZE</button>
                    </div>
                    <div ref={liveRef} style={{ height:180, overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
                      {liveLog.map((line, i) => (
                        <div key={i} className="live-line" style={{
                          fontSize:10.5, lineHeight:1.6, fontFamily:"'JetBrains Mono',monospace",
                          color: line.includes("CRITICAL") ? "#ef4444" : line.includes("ERROR") ? "#f97316" : line.includes("WARN") ? "#f59e0b" : "#4b6a8a",
                          padding:"1px 0",
                        }}>{line}</div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="glass" style={{ borderRadius:10, padding:16, marginBottom:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <span style={{ fontSize:9, color:"#475569", letterSpacing:2 }}>
                        ▸ PASTE {srcMeta.label.toUpperCase()} LOGS
                      </span>
                      <button onClick={() => setLogs(SAMPLES[source])} style={{
                        background:"rgba(56,189,248,0.07)", border:"1px solid rgba(56,189,248,0.2)",
                        color:"#38bdf8", borderRadius:5, padding:"3px 11px", fontSize:10, fontWeight:700,
                      }}>Load Sample</button>
                    </div>
                    <textarea value={logs} onChange={e => setLogs(e.target.value)}
                      placeholder={`Paste ${srcMeta.label} logs here…`} rows={8}
                      style={{
                        width:"100%", background:"rgba(0,0,0,0.3)", border:"1px solid #1e2736",
                        borderRadius:7, color:"#7dd3fc", padding:"11px 14px",
                        fontSize:11.5, lineHeight:1.8, resize:"vertical", fontFamily:"inherit",
                      }}/>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12 }}>
                      <span style={{ fontSize:9, color:"#1e3a5f" }}>Signal Extraction → Multi-Agent AI → Root Cause → Recovery</span>
                      <button onClick={analyze} disabled={loading || !logs.trim()} style={{
                        background: loading ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,#ef4444,#f97316)",
                        border:"none", color:"#fff", borderRadius:7, padding:"9px 26px",
                        fontSize:12, fontWeight:700, letterSpacing:1,
                        display:"flex", alignItems:"center", gap:8,
                        boxShadow: loading ? "none" : "0 0 24px #ef444466",
                      }}>
                        {loading
                          ? <><span style={{ display:"inline-block", width:12, height:12,
                              border:"2px solid #fff", borderTopColor:"transparent",
                              borderRadius:"50%", animation:"spin .7s linear infinite" }}/> ANALYZING…</>
                          : "⚡ ANALYZE INCIDENT"}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="fadeUp glass" style={{ borderRadius:8, padding:"12px 18px",
                    marginBottom:14, borderColor:"rgba(239,68,68,0.3)" }}>
                    <span style={{ color:"#ef4444" }}>✗ {error}</span>
                  </div>
                )}

                {result && (
                  <div className="fadeUp">
                    {/* Severity banner — pulses red if war room */}
                    <div className={`glass${isWarRoom ? " war-room-bg" : ""}`} style={{
                      borderRadius:10, padding:"16px 20px",
                      borderColor: cfg.color + "33",
                      boxShadow: isWarRoom
                        ? `0 0 50px #ef444444, 0 0 100px #ef444422`
                        : `0 0 30px ${cfg.glow}`,
                      marginBottom:14,
                      display:"flex", justifyContent:"space-between", alignItems:"center",
                      animation: isWarRoom ? "warRoomGlow .8s ease-in-out 3" : "none",
                    }}>
                      <div>
                        <div style={{ fontSize:8, color:"#475569", letterSpacing:2, marginBottom:8 }}>INCIDENT SEVERITY</div>
                        <span style={{
                          background: cfg.bg, color:cfg.color,
                          border:`1px solid ${cfg.color}66`,
                          borderRadius:5, padding:"4px 14px",
                          fontSize:13, fontWeight:700, letterSpacing:2,
                          boxShadow:`0 0 12px ${cfg.glow}`,
                        }}>● {result.severity}</span>
                        {/* FEATURE 2: Streaming severity reason */}
                        <p style={{ color:"#64748b", fontSize:11, marginTop:8, maxWidth:340 }}>
                          {streamingText.severity_reason
                            ? <TypewriterText text={result.severity_reason} speed={12} color="#64748b" />
                            : result.severity_reason}
                        </p>
                      </div>
                      <div style={{ display:"flex", gap:24 }}>
                        {[
                          { label:"AI CONFIDENCE", val:`${result.confidence}%`, color:cfg.color },
                          { label:"SIGNALS",        val:signals.length,           color:"#38bdf8" },
                          { label:"SEV SCORE",      val:result._severity_score,   color:"#f97316" },
                        ].map(k => (
                          <div key={k.label} style={{ textAlign:"center" }}>
                            <div style={{ fontSize:8, color:"#475569", letterSpacing:1, marginBottom:4 }}>{k.label}</div>
                            <div style={{ fontSize:26, fontWeight:800, color:k.color,
                              fontFamily:"'Syne',sans-serif", textShadow:`0 0 20px ${k.color}66` }}>{k.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Root cause + Business impact */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                      <div className="glass" style={{ borderRadius:10, padding:16 }}>
                        <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:10 }}>◈ ROOT CAUSE</div>
                        {/* FEATURE 2: Typewriter root cause */}
                        <p style={{ color:"#e2e8f0", fontSize:13, lineHeight:1.75 }}>
                          {streamingText.root_cause
                            ? <TypewriterText text={result.root_cause} speed={14} color="#e2e8f0" />
                            : result.root_cause}
                        </p>
                        {result.business_impact && (
                          <p style={{ color:"#f97316", fontSize:11, marginTop:10, lineHeight:1.6 }}>
                            💥 {result.business_impact}
                          </p>
                        )}
                      </div>
                      <div className="glass" style={{ borderRadius:10, padding:16 }}>
                        <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:10 }}>◈ AFFECTED SERVICES</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                          {(result.affected_services || []).map((s, i) => (
                            <span key={i} style={{
                              background:"rgba(56,189,248,0.08)", color:"#38bdf8",
                              border:"1px solid rgba(56,189,248,0.2)", borderRadius:5,
                              padding:"3px 12px", fontSize:11,
                            }}>{s}</span>
                          ))}
                        </div>
                        <div style={{ marginTop:14 }}>
                          <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:8 }}>◈ SIGNALS DETECTED</div>
                          {signals.slice(0,4).map((s, i) => (
                            <div key={i} style={{
                              display:"flex", gap:8, padding:"5px 10px",
                              background:"rgba(0,0,0,0.2)", borderRadius:5,
                              borderLeft:`2px solid ${CAT_COLORS[s.category] || "#475569"}`,
                              marginBottom:5,
                            }}>
                              <span style={{ fontSize:9, color:CAT_COLORS[s.category]||"#64748b", fontWeight:700 }}>[{s.category.toUpperCase()}]</span>
                              <span style={{ fontSize:10, color:"#94a3b8", flex:1 }}>{s.description}</span>
                              {s.count > 1 && <span style={{ fontSize:9, color:"#475569" }}>×{s.count}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Timeline + Fix scripts */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                      <div className="glass" style={{ borderRadius:10, padding:16 }}>
                        <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:12 }}>◈ EVENT TIMELINE</div>
                        {(result.timeline || []).map((item, i) => (
                          <div key={i} style={{ display:"flex", gap:10, marginBottom:11 }}>
                            <span style={{ color:"#f97316", fontSize:10, minWidth:65, paddingTop:2 }}>{item.time}</span>
                            <div style={{ flex:1, paddingLeft:10, borderLeft:"1px solid #1e2736",
                              fontSize:11, color:"#94a3b8", lineHeight:1.6 }}>{item.event}</div>
                          </div>
                        ))}
                      </div>
                      <div className="glass" style={{ borderRadius:10, padding:16 }}>
                        <div style={{ fontSize:9, color:"#22c55e", letterSpacing:2, marginBottom:12 }}>◈ ONE-CLICK FIX SCRIPTS</div>
                        {fixes.map((f, i) => (
                          <div key={i} style={{
                            background:"rgba(0,0,0,0.3)", border:"1px solid #1e2736",
                            borderRadius:7, padding:"8px 12px", marginBottom:8,
                          }}>
                            <div style={{ fontSize:9, color:"#22c55e", marginBottom:5 }}>{f.label}</div>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <code style={{ flex:1, fontSize:10, color:"#7dd3fc",
                                overflowX:"auto", whiteSpace:"nowrap" }}>{f.cmd}</code>
                              <button onClick={() => copyScript(f.cmd, i)} style={{
                                background: copiedIdx === i ? "rgba(34,197,94,0.1)" : "rgba(56,189,248,0.07)",
                                border:`1px solid ${copiedIdx===i ? "rgba(34,197,94,0.3)" : "rgba(56,189,248,0.15)"}`,
                                color: copiedIdx === i ? "#22c55e" : "#38bdf8",
                                borderRadius:5, padding:"3px 9px", fontSize:9, fontWeight:700,
                                whiteSpace:"nowrap",
                              }}>{copiedIdx === i ? "✓ COPIED" : "COPY"}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Summary with typewriter */}
                    <div className="glass" style={{ borderRadius:10, padding:16, marginBottom:12 }}>
                      <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:10 }}>◈ EXECUTIVE SUMMARY</div>
                      <p style={{ color:"#cbd5e1", lineHeight:1.85, fontSize:13 }}>
                        {streamingText.summary
                          ? <TypewriterText text={result.summary} speed={10} color="#cbd5e1" />
                          : result.summary}
                      </p>
                    </div>

                    <div style={{ textAlign:"center" }}>
                      <button onClick={() => setTab("chat")} style={{
                        background:"rgba(56,189,248,0.07)", border:"1px solid rgba(56,189,248,0.2)",
                        color:"#38bdf8", borderRadius:8, padding:"9px 22px",
                        fontSize:11, fontWeight:700, letterSpacing:1,
                      }}>💬 ASK AI ABOUT THIS INCIDENT →</button>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT SIDEBAR */}
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

                {/* Multi-agent pipeline */}
                <div className="glass" style={{ borderRadius:10, padding:16,
                  borderColor: isWarRoom ? "rgba(239,68,68,0.2)" : undefined,
                  boxShadow: isWarRoom ? "0 0 20px rgba(239,68,68,0.1)" : undefined,
                }}>
                  <div style={{ fontSize:9, color: isWarRoom ? "#ef4444" : "#475569",
                    letterSpacing:2, marginBottom:12 }}>
                    ◈ AI AGENT PIPELINE {isWarRoom ? "— MOBILIZED" : ""}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                    {AGENTS.map((agent, i) => (
                      <AgentPill key={agent.id} agent={agent}
                        active={loading && agentStep === i}
                        done={agentStep > i || (!loading && result !== null)}/>
                    ))}
                  </div>
                </div>

                {/* AI Explainability */}
                {result && (
                  <div className="glass fadeUp" style={{ borderRadius:10, padding:16 }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:12 }}>◈ WHY AI THINKS THIS</div>
                    {explainSignals.map((s, i) => (
                      <ConfidenceBar key={i} label={s.label} pct={s.pct} color={s.color}/>
                    ))}
                    <div style={{ marginTop:12, padding:"8px 10px",
                      background:"rgba(0,0,0,0.2)", borderRadius:6,
                      fontSize:10, color:"#64748b", lineHeight:1.6,
                      borderLeft:"2px solid #38bdf833" }}>
                      Hybrid engine: deterministic signals pre-confirmed before LLM reasoning.
                    </div>
                  </div>
                )}

                {/* Service Dependency Map */}
                {result && (
                  <div className="glass fadeUp2" style={{ borderRadius:10, padding:16 }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:10 }}>◈ SERVICE DEPENDENCY MAP</div>
                    <ServiceMap result={result}/>
                    <div style={{ fontSize:9, color:"#334155", marginTop:8, textAlign:"center" }}>
                      ✕ = failed service  ·  dashed = degraded path
                    </div>
                  </div>
                )}

                {/* Similar past incident */}
                {result && (
                  <div className="glass fadeUp3" style={{ borderRadius:10, padding:16, borderColor:"rgba(167,139,250,0.2)" }}>
                    <div style={{ fontSize:9, color:"#a78bfa", letterSpacing:2, marginBottom:10 }}>◈ SIMILAR PAST INCIDENT</div>
                    {MOCK_HISTORY.filter(h =>
                      signals.some(s => h.cause.toLowerCase().includes(s.category)) ||
                      (result.affected_services||[]).some(svc => h.services.includes(svc))
                    ).slice(0,1).map(h => (
                      <div key={h.id}>
                        <div style={{ fontSize:11, color:"#e2e8f0", marginBottom:5 }}>{h.date}</div>
                        <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.6 }}>{h.cause}</div>
                        <div style={{ display:"flex", gap:8, marginTop:8 }}>
                          <span style={{ fontSize:9, color:SEV[h.severity]?.color, background:SEV[h.severity]?.bg,
                            border:`1px solid ${SEV[h.severity]?.color}44`, borderRadius:4, padding:"2px 8px" }}>
                            {h.severity}
                          </span>
                          <span style={{ fontSize:9, color:"#475569" }}>⏱ {h.duration}</span>
                        </div>
                        <div style={{ marginTop:8, fontSize:9, color:"#22c55e" }}>✓ Pattern match found</div>
                      </div>
                    ))}
                    {signals.length === 0 && (
                      <div style={{ fontSize:11, color:"#334155" }}>Run analysis to find similar incidents.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ══════════════════ DASHBOARD TAB ══════════════════ */}
        {tab === "dashboard" && (
          <div className="fadeUp">
            <StatusBar severity={result?.severity} warRoom={isWarRoom} />
            <KPIStrip result={result} impact={impact} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>
              <div className="glass" style={{ borderRadius:10, padding:18, gridColumn:"span 2" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:2 }}>◈ INCIDENT FREQUENCY — MAY 2026</div>
                  <div style={{ display:"flex", gap:8 }}>
                    {[["#38bdf8","LOW/MEDIUM"],["#f97316","HIGH"],["#ef4444","CRITICAL"]].map(([c,l])=>(
                      <div key={l} style={{ display:"flex", gap:4, alignItems:"center" }}>
                        <div style={{ width:7, height:7, background:c, borderRadius:1 }}/>
                        <span style={{ fontSize:8, color:"#475569" }}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <FreqChart/>
              </div>
              <div className="glass" style={{ borderRadius:10, padding:18 }}>
                <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:14 }}>◈ SEVERITY DISTRIBUTION</div>
                <SeverityDonut/>
              </div>
            </div>
            <div className="glass" style={{ borderRadius:10, padding:18, marginBottom:14 }}>
              <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:16 }}>◈ SYSTEM HEALTH — LIVE</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16 }}>
                {(result ? [
                  { label:"CPU",    val:metrics.cpu,      color:"#38bdf8" },
                  { label:"MEMORY", val:metrics.memory,   color:"#a78bfa" },
                  { label:"LATENCY",val:metrics.latency,  color:"#f97316" },
                  { label:"ERRORS", val:metrics.errorRate,color:"#ef4444" },
                ] : [
                  { label:"CPU",    val:34, color:"#38bdf8" },
                  { label:"MEMORY", val:52, color:"#a78bfa" },
                  { label:"LATENCY",val:18, color:"#f97316" },
                  { label:"ERRORS", val:2,  color:"#ef4444" },
                ]).map(m => (
                  <div key={m.label} style={{ textAlign:"center" }}>
                    <Gauge value={Math.round(m.val)} color={m.color} label={m.label}/>
                  </div>
                ))}
              </div>
            </div>
            {result && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                {[
                  { label:"CPU TREND",    data:metrics.cpuSpark,      color:"#38bdf8" },
                  { label:"MEMORY TREND", data:metrics.memorySpark,   color:"#a78bfa" },
                  { label:"LATENCY",      data:metrics.latencySpark,  color:"#f97316" },
                  { label:"ERROR RATE",   data:metrics.errorSpark,    color:"#ef4444" },
                ].map(m => (
                  <div key={m.label} className="glass" style={{ borderRadius:10, padding:14 }}>
                    <div style={{ fontSize:8, color:"#475569", letterSpacing:2, marginBottom:8 }}>{m.label}</div>
                    <Sparkline data={m.data} color={m.color} width={160} height={40}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ CHAT TAB ══════════════════ */}
        {tab === "chat" && (
          <div className="fadeUp">
            {!result ? (
              <div style={{ textAlign:"center", padding:"80px 0", color:"#475569" }}>
                <div style={{ fontSize:42, marginBottom:16 }}>💬</div>
                <p style={{ fontSize:14 }}>Analyze an incident first, then chat with the AI.</p>
                <button onClick={() => setTab("analyze")} style={{
                  marginTop:20, background:"rgba(56,189,248,0.07)",
                  border:"1px solid rgba(56,189,248,0.2)", color:"#38bdf8",
                  borderRadius:7, padding:"8px 18px", fontSize:11, fontWeight:700, letterSpacing:1,
                }}>← GO TO ANALYZE</button>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 280px", gap:16 }}>
                <div>
                  <div style={{ padding:"8px 14px", background:"rgba(255,255,255,0.02)",
                    border:`1px solid ${cfg.color}22`, borderRadius:7,
                    fontSize:11, color:"#64748b", marginBottom:12 }}>
                    Context: <span style={{ color:cfg.color }}>●</span>{" "}
                    <span style={{ color:"#e2e8f0" }}>{result.severity}</span> — {result.root_cause}
                  </div>

                  {chatHistory.length === 0 && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                      {["Why did this happen?","What's the business impact?",
                        "How do I prevent this?","Estimate recovery time",
                        "What's the blast radius?","Generate runbook"].map((q, i) => (
                        <button key={i} onClick={() => setChatInput(q)} style={{
                          background:"rgba(255,255,255,0.02)", border:"1px solid #1e2736",
                          color:"#64748b", borderRadius:6, padding:"5px 12px", fontSize:10,
                        }}>{q}</button>
                      ))}
                    </div>
                  )}

                  <div style={{ height:380, overflowY:"auto", display:"flex",
                    flexDirection:"column", gap:10, marginBottom:12,
                    border:"1px solid #1e2736", borderRadius:10, padding:14,
                    background:"rgba(0,0,0,0.2)" }}>
                    {chatHistory.length === 0 && (
                      <div style={{ color:"#334155", fontSize:11, textAlign:"center", paddingTop:60 }}>
                        Ask anything about this incident…
                      </div>
                    )}
                    {/* FEATURE 2: Streaming chat bubbles */}
                    {chatHistory.map((m, i) => (
                      <div key={i} style={{ display:"flex",
                        justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                          maxWidth:"78%", padding:"10px 14px", borderRadius:8,
                          fontSize:12, lineHeight:1.75,
                          background: m.role === "user" ? "rgba(56,189,248,0.08)" : "rgba(255,255,255,0.03)",
                          border:`1px solid ${m.role==="user" ? "rgba(56,189,248,0.2)" : "#1e2736"}`,
                          color: m.role === "user" ? "#7dd3fc" : "#cbd5e1",
                          whiteSpace:"pre-wrap",
                        }}>
                          {m.content}
                          {m.streaming && <span style={{ animation:"blink .7s step-start infinite", color:"#38bdf8" }}>▌</span>}
                        </div>
                      </div>
                    ))}
                    {chatLoading && chatHistory[chatHistory.length-1]?.role !== "assistant" && (
                      <div style={{ color:"#475569", fontSize:11 }}>
                        <span style={{ animation:"blink 1s step-start infinite" }}>█</span> Thinking…
                      </div>
                    )}
                    <div ref={chatEndRef}/>
                  </div>

                  <div style={{ display:"flex", gap:8 }}>
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); sendChat(); }}}
                      placeholder="Ask about this incident… (Enter to send)"
                      style={{ flex:1, background:"rgba(0,0,0,0.3)", border:"1px solid #1e2736",
                        borderRadius:7, padding:"10px 14px", color:"#cbd5e1",
                        fontSize:12, fontFamily:"inherit" }}/>
                    <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{
                      background:"linear-gradient(135deg,#38bdf8,#1d6396)",
                      border:"none", color:"#fff", borderRadius:7,
                      padding:"10px 18px", fontSize:12, fontWeight:700, letterSpacing:1,
                    }}>SEND ⏎</button>
                  </div>
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div className="glass" style={{ borderRadius:10, padding:16 }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:12 }}>◈ WHY AI THINKS THIS</div>
                    {explainSignals.map((s, i) => <ConfidenceBar key={i} label={s.label} pct={s.pct} color={s.color}/>)}
                  </div>
                  {impact && (
                    <div className="glass" style={{ borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:10 }}>◈ FINANCIAL IMPACT</div>
                      <FinancialKPI impact={impact} />
                    </div>
                  )}
                  <div className="glass" style={{ borderRadius:10, padding:16 }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:12 }}>◈ FIX SCRIPTS</div>
                    {fixes.slice(0,3).map((f, i) => (
                      <div key={i} style={{ marginBottom:8 }}>
                        <div style={{ fontSize:9, color:"#22c55e", marginBottom:4 }}>{f.label}</div>
                        <button onClick={() => copyScript(f.cmd, i+100)} style={{
                          width:"100%", background:"rgba(0,0,0,0.3)", border:"1px solid #1e2736",
                          color: copiedIdx === i+100 ? "#22c55e" : "#7dd3fc",
                          borderRadius:5, padding:"5px 8px", fontSize:9,
                          textAlign:"left", fontFamily:"'JetBrains Mono',monospace",
                          overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis",
                        }}>{copiedIdx===i+100 ? "✓ Copied!" : f.cmd}</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ HISTORY TAB ══════════════════ */}
        {tab === "history" && (
          <div className="fadeUp">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:16 }}>
              <div>
                <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:14 }}>◈ INCIDENT HISTORY</div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {MOCK_HISTORY.map((h, i) => (
                    <div key={h.id} className="glass" style={{
                      borderRadius:10, padding:18,
                      borderColor: SEV[h.severity]?.color + "22",
                      boxShadow:`0 0 16px ${SEV[h.severity]?.glow}`,
                      animation:`fadeUp .35s ${i*0.07}s ease both`,
                    }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div>
                          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                            <span style={{
                              background:SEV[h.severity]?.bg, color:SEV[h.severity]?.color,
                              border:`1px solid ${SEV[h.severity]?.color}44`,
                              borderRadius:4, padding:"2px 10px", fontSize:10, fontWeight:700, letterSpacing:1,
                            }}>● {h.severity}</span>
                            <span style={{ fontSize:11, color:"#475569" }}>{h.date}</span>
                            <span style={{ fontSize:10, color:"#334155" }}>⏱ {h.duration}</span>
                          </div>
                          <p style={{ fontSize:13, color:"#e2e8f0", marginBottom:8 }}>{h.cause}</p>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                            {h.services.map(s => (
                              <span key={s} style={{ fontSize:9, color:"#38bdf8",
                                background:"rgba(56,189,248,0.07)", border:"1px solid rgba(56,189,248,0.15)",
                                borderRadius:4, padding:"2px 8px" }}>{s}</span>
                            ))}
                          </div>
                        </div>
                        <button style={{
                          background:"rgba(255,255,255,0.02)", border:"1px solid #1e2736",
                          color:"#475569", borderRadius:6, padding:"5px 12px", fontSize:9, fontWeight:700,
                        }}>VIEW REPORT</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <div className="glass" style={{ borderRadius:10, padding:18 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:14 }}>◈ RECURRING PATTERNS</div>
                  {[
                    { pattern:"DB connection exhaustion", count:4, color:"#f97316" },
                    { pattern:"Redis OOM / cache eviction", count:3, color:"#ef4444" },
                    { pattern:"Pod CrashLoopBackOff", count:3, color:"#a78bfa" },
                    { pattern:"Upstream timeout cascade", count:2, color:"#38bdf8" },
                  ].map(p => (
                    <div key={p.pattern} style={{ display:"flex", justifyContent:"space-between",
                      alignItems:"center", marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:11, color:"#94a3b8" }}>{p.pattern}</div>
                        <div style={{ height:3, background:"#1e2736", borderRadius:2, marginTop:5, width:160 }}>
                          <div style={{ height:"100%", width:`${(p.count/4)*100}%`,
                            background:p.color, borderRadius:2 }}/>
                        </div>
                      </div>
                      <span style={{ fontSize:14, fontWeight:800, color:p.color,
                        fontFamily:"'Syne',sans-serif" }}>{p.count}×</span>
                    </div>
                  ))}
                </div>
                <div className="glass" style={{ borderRadius:10, padding:18 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:14 }}>◈ SEVERITY DISTRIBUTION</div>
                  <SeverityDonut/>
                </div>
                <div className="glass" style={{ borderRadius:10, padding:18 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:2, marginBottom:12 }}>◈ INCIDENT FREQUENCY</div>
                  <FreqChart/>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
