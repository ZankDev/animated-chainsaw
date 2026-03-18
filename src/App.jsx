import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE = "http://localhost:3001/api";
const STATUS = { PENDING: "pending", PROCESSING: "processing", DONE: "done", ERROR: "error", DUPLICATE: "duplicate" };
const CONCURRENT_LIMIT = 1;
const USD_ILS_RATES = { 1: 3.61, 2: 3.55, 3: 3.65, 4: 3.69, 5: 3.56, 6: 3.47, 7: 3.35, 8: 3.38, 9: 3.34, 10: 3.29, 11: 3.26, 12: 3.20 };

function convertUsdToIls(result) {
  if (!result?.amount || !result?.date) return null;
  const amountStr = result.amount.trim();
  const isDollar = amountStr.includes("$") || amountStr.toLowerCase().includes("usd");
  if (!isDollar) return null;
  const num = parseFloat(amountStr.replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return null;
  let month = null;
  const dmyMatch = result.date.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmyMatch) {
    const possibleMonth = parseInt(dmyMatch[2], 10);
    if (possibleMonth >= 1 && possibleMonth <= 12) month = possibleMonth;
    else {
      const altMonth = parseInt(dmyMatch[1], 10);
      if (altMonth >= 1 && altMonth <= 12) month = altMonth;
    }
  }
  if (!month) {
    const ymdMatch = result.date.match(/(\d{4})[\/\-.](\d{1,2})/);
    if (ymdMatch) month = parseInt(ymdMatch[2], 10);
  }
  if (!month || !USD_ILS_RATES[month]) return null;
  const rate = USD_ILS_RATES[month];
  const ilsAmount = num * rate;
  return { ilsAmount: ilsAmount.toFixed(2), rate, usdAmount: num.toFixed(2), month };
}

function normalizeAmount(amount) {
  if (!amount) return "";
  const num = parseFloat(amount.replace(/[^0-9.\-]/g, ""));
  return isNaN(num) ? amount.trim().toLowerCase() : num.toFixed(2);
}

function hashRecord(rec) {
  return `${(rec.date || "").trim()}|${(rec.supplier || "").trim().toLowerCase()}|${normalizeAmount(rec.amount)}|${(rec.reference || "").trim().toLowerCase()}`;
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function getMediaType(file) {
  const ext = file.name.toLowerCase().split(".").pop();
  const map = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  return map[ext] || file.type || "application/octet-stream";
}

async function processWithClaude(file, apiKey) {
  const base64Data = await fileToBase64(file);
  const mediaType = getMediaType(file);
  const isPdf = mediaType === "application/pdf";
  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1000,
      messages: [{ role: "user", content: [contentBlock, { type: "text", text: `Extract: date (DD/MM/YYYY), supplier, amount (with currency), reference, description (max 10 words). JSON only:` }] }]
    })
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  const text = data.content[0].text;
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function processWithOllama(file) {
  const base64Data = await fileToBase64(file);
  const response = await fetch(`${API_BASE}/ollama/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: `Analyze document. Extract: date, supplier, amount, reference, description. Return JSON only.` })
  });
  if (!response.ok) throw new Error("Ollama error");
  const data = await response.json();
  const clean = data.response.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

function ProgressBar({ value, max, color = "var(--accent)" }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return <div style={{ width: "100%", height: 8, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: color, transition: "width 0.4s ease" }} />
  </div>;
}

function StatusBadge({ status }) {
  const config = {
    [STATUS.PENDING]: { label: "ממתין", bg: "#3a3a4a", color: "#aaa" },
    [STATUS.PROCESSING]: { label: "מעבד...", bg: "#1a3a5c", color: "#5ba3e6" },
    [STATUS.DONE]: { label: "הושלם", bg: "#1a3c2a", color: "#4ade80" },
    [STATUS.ERROR]: { label: "שגיאה", bg: "#3c1a1a", color: "#f87171" },
    [STATUS.DUPLICATE]: { label: "כפול", bg: "#3c3a1a", color: "#fbbf24" }
  };
  const c = config[status] || config[STATUS.PENDING];
  return <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>{c.label}</span>;
}

function FileRow({ item, index }) {
  const conversion = item.result ? convertUsdToIls(item.result) : null;
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{index + 1}</td>
      <td style={{ padding: "10px 12px", fontSize: 13, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.file.name}</td>
      <td style={{ padding: "10px 12px" }}><StatusBadge status={item.status} /></td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.date || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.supplier || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.amount || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{conversion ? <span style={{ color: "#4ade80" }}>₪{conversion.ilsAmount}</span> : "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.reference || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.description || "—"}</td>
    </tr>
  );
}

export default function DocumentProcessor() {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [useLocal, setUseLocal] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState(null);
  const [eta, setEta] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [ollamaInitMessage, setOllamaInitMessage] = useState("");
  const [warmupStatus, setWarmupStatus] = useState(null);

  const inputRef = useRef(null);
  const processingRef = useRef(false);
  const seenHashesRef = useRef(new Set());
  const filesRef = useRef([]);

  useEffect(() => { filesRef.current = files; }, [files]);

  // Check warmup status
  useEffect(() => {
    const checkWarmup = async () => {
      try {
        const res = await fetch(`${API_BASE}/warmup-status`);
        const data = await res.json();
        setWarmupStatus(data);
      } catch (err) {
        console.error('Warmup check error:', err);
      }
    };
    
    checkWarmup();
    const interval = setInterval(checkWarmup, 1000); // Update every second
    return () => clearInterval(interval);
  }, []);

  // Check Ollama status
      try {
        const res = await fetch(`${API_BASE}/ollama/status`);
        const data = await res.json();
        if (data.running) {
          setOllamaStatus("ready");
          setOllamaInitMessage("✅ Server Ready - Processing Available");
          setUseLocal(true);  // Auto-use server Ollama when ready
        } else {
          setOllamaStatus("offline");
          setOllamaInitMessage("⏳ Server initializing AI model... (4-5 min on first deploy)");
        }
      } catch {
        setOllamaStatus("error");
        setOllamaInitMessage("⚠️ Connection checking...");
      }
    };
    checkOllama();
    const interval = setInterval(checkOllama, 3000);  // Check every 3 seconds for faster detection
    return () => clearInterval(interval);
  }, []);

  const stats = {
    total: files.length,
    done: files.filter((f) => f.status === STATUS.DONE).length,
    duplicates: files.filter((f) => f.status === STATUS.DUPLICATE).length,
    errors: files.filter((f) => f.status === STATUS.ERROR).length,
    processing: files.filter((f) => f.status === STATUS.PROCESSING).length,
    pending: files.filter((f) => f.status === STATUS.PENDING).length,
  };

  const addFiles = useCallback((newFiles) => {
    const accepted = Array.from(newFiles).filter((f) => {
      const ext = f.name.toLowerCase().split(".").pop();
      return ["pdf", "jpg", "jpeg", "png", "gif", "webp"].includes(ext);
    });
    const items = accepted.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: STATUS.PENDING,
      result: null,
      error: null,
    }));
    setFiles((prev) => [...prev, ...items]);
  }, []);

  // Server auto-initializes Ollama on hosting deployment
  // No manual setup needed on user PC

  const bypassWarmup = async () => {
    try {
      const res = await fetch(`${API_BASE}/bypass-warmup`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setWarmupStatus(prev => ({ ...prev, warmed: true, remainingSeconds: 0 }));
        alert('✅ Session warmup bypassed!');
      }
    } catch (err) {
      console.error('Bypass error:', err);
    }
  };

  const setupOllama = async () => {
    setSetupLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ollama/setup`, { method: "POST" });
      const data = await res.json();
      if (!data.success && data.needsManualInstall) {
        alert("📥 Download from https://ollama.ai and run it, then try again.");
        window.open("https://ollama.ai", "_blank");
      } else {
        alert("⏳ Downloading Mistral model... (may take a few minutes)");
        setUseLocal(true);
      }
    } catch (err) {
      alert("❌ Error: " + err.message);
    }
    setSetupLoading(false);
  };

  const processAll = useCallback(async () => {
    if (!useLocal && !apiKey) {
      alert("❌ Need API key or wait for server model to initialize!");
      return;
    }
    if (processingRef.current || stats.pending === 0) return;

    processingRef.current = true;
    setIsProcessing(true);
    setStartTime(Date.now());
    seenHashesRef.current = new Set();

    setFiles((prev) => {
      const updated = prev.map((f) =>
        f.status === STATUS.DONE || f.status === STATUS.DUPLICATE ? f : { ...f, status: STATUS.PENDING, result: null, error: null }
      );
      updated.forEach((f) => {
        if (f.status === STATUS.DONE && f.result) seenHashesRef.current.add(hashRecord(f.result));
      });
      filesRef.current = updated;
      return updated;
    });

    await new Promise((r) => setTimeout(r, 150));

    const pendingIds = filesRef.current.filter((f) => f.status === STATUS.PENDING).map((f) => f.id);
    if (pendingIds.length === 0) {
      processingRef.current = false;
      setIsProcessing(false);
      return;
    }

    let nextIndex = 0;
    const totalPending = pendingIds.length;

    const processNext = async () => {
      while (nextIndex < pendingIds.length) {
        const idx = nextIndex++;
        const itemId = pendingIds[idx];
        const item = filesRef.current.find((f) => f.id === itemId);
        if (!item?.file) continue;

        setFiles((prev) => {
          const updated = prev.map((f) => f.id === itemId ? { ...f, status: STATUS.PROCESSING } : f);
          filesRef.current = updated;
          return updated;
        });

        const processed = totalPending - (pendingIds.length - idx);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgTime = elapsed / Math.max(processed, 1);
        const remainingTime = avgTime * (pendingIds.length - idx);
        setEta(remainingTime);

        try {
          const result = useLocal ? await processWithOllama(item.file) : await processWithClaude(item.file, apiKey);
          const h = hashRecord(result);
          const isDuplicate = seenHashesRef.current.has(h);
          if (!isDuplicate) seenHashesRef.current.add(h);

          setFiles((prev) => {
            const updated = prev.map((f) =>
              f.id === itemId ? { ...f, status: isDuplicate ? STATUS.DUPLICATE : STATUS.DONE, result } : f
            );
            filesRef.current = updated;
            return updated;
          });
        } catch (err) {
          setFiles((prev) => {
            const updated = prev.map((f) => f.id === itemId ? { ...f, status: STATUS.ERROR, error: err.message } : f);
            filesRef.current = updated;
            return updated;
          });
        }

        await new Promise((r) => setTimeout(r, 2000));
      }
    };

    await processNext();
    processingRef.current = false;
    setIsProcessing(false);
    setEta(null);
  }, [useLocal, apiKey, stats.pending, startTime]);

  return (
    <div dir="rtl" style={{ fontFamily: "'Segoe UI', sans-serif", minHeight: "100vh", background: "#0d0d12", color: "#e0e0e8", "--bg-primary": "#0d0d12", "--bg-secondary": "#16161f", "--bg-tertiary": "#1e1e2a", "--border": "#2a2a3a", "--text-primary": "#e0e0e8", "--text-secondary": "#8888a0", "--accent": "#6366f1" }}>
      {/* Header */}
      <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 28 }}>📄</div>
          <div><h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>מעבד מסמכים</h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>חילוץ + זיהוי כפילויות</p>
          </div>
        </div>

        {/* Model Controls */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {!useLocal && (
            <input
              type="password"
              placeholder="Claude API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 12, minWidth: 150 }}
            />
          )}
          
          {/* Warmup Status */}
          {warmupStatus && !warmupStatus.warmed && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: 8, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24" }}>
                ⏱️ {warmupStatus.remainingSeconds}s
              </div>
              <button 
                onClick={bypassWarmup}
                style={{ 
                  padding: "4px 8px", 
                  borderRadius: 6, 
                  border: "1px solid rgba(251,191,36,0.3)",
                  background: "rgba(251,191,36,0.2)", 
                  color: "#fbbf24", 
                  fontSize: 11, 
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
                onMouseOver={(e) => e.target.style.background = "rgba(251,191,36,0.3)"}
                onMouseOut={(e) => e.target.style.background = "rgba(251,191,36,0.2)"}
              >
                Bypass
              </button>
            </div>
          )}

          <div style={{ padding: "8px 12px", borderRadius: 8, background: ollamaStatus === "ready" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)", color: ollamaStatus === "ready" ? "#4ade80" : "#f87171", fontSize: 11, fontWeight: 600, minWidth: 200, textAlign: "center" }}>
            {ollamaInitMessage || (ollamaStatus === "ready" ? "🟢 Server Ready" : ollamaStatus === "offline" ? "🔴 Initializing..." : "⚠️ Error")}
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px" }}>
        {/* Warmup Progress Bar */}
        {warmupStatus && !warmupStatus.warmed && (
          <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24" }}>
                Session Warmup: {warmupStatus.remainingSeconds}s remaining
              </span>
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                {warmupStatus.warmedUpPercent}%
              </span>
            </div>
            <ProgressBar value={warmupStatus.warmedUpPercent} max={100} color="#fbbf24" />
            <p style={{ margin: "8px 0 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
              ⚠️ Waiting for session to warm up (prevents first-message ban on hosting platforms)
            </p>
          </div>
        )}

        {/* Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
          style={{ border: `2px dashed ${dragOver ? "#6366f1" : "#2a2a3a"}`, borderRadius: 16, padding: "40px 24px", textAlign: "center", background: dragOver ? "rgba(99,102,241,0.08)" : "var(--bg-secondary)", transition: "all 0.3s ease", marginBottom: 24 }}
        >
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
          <div style={{ fontSize: 42, marginBottom: 12 }}>{dragOver ? "📥" : "📎"}</div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>גרור קבצים</p>
          <button onClick={() => inputRef.current?.click()} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", cursor: "pointer" }}>📄 בחר</button>
        </div>

        {/* Stats */}
        {files.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {[{ label: "סה״כ", value: stats.total }, { label: "הושלם", value: stats.done }, { label: "בעיבוד", value: stats.processing }].map((s) => (
                <div key={s.label} style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "10px 18px", textAlign: "center", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {isProcessing && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                  <span>{stats.done} / {stats.total}</span>
                  <span>⏱️ כמה זמן נשאר: {eta ? formatTime(eta) : "..."}</span>
                </div>
                <ProgressBar value={stats.done} max={stats.total} />
              </div>
            )}

            <button onClick={processAll} disabled={isProcessing || (!useLocal && !apiKey)} style={{
              padding: "10px 24px", borderRadius: 10, border: "none",
              background: isProcessing ? "#2a2a3a" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: isProcessing ? "#666" : "#fff", fontSize: 14, fontWeight: 600, cursor: isProcessing ? "not-allowed" : "pointer"
            }}>
              {isProcessing ? "⏳ מעבד..." : "▶️ התחל"}
            </button>
          </>
        )}

        {/* Table */}
        {files.filter(f => f.status === STATUS.DONE || f.status === STATUS.DUPLICATE).length > 0 && (
          <div style={{ marginTop: 20, borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--bg-secondary)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg-tertiary)" }}>
                    {["#", "קובץ", "סטטוס", "תאריך", "ספק", "סכום", "₪", "אסמכתא", "תיאור"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {files.filter(f => f.status === STATUS.DONE || f.status === STATUS.DUPLICATE).map((item, i) => (
                    <FileRow key={item.id} item={item} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {files.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <p style={{ fontSize: 15 }}>העלה מסמכים כדי להתחיל</p>
          </div>
        )}
      </div>
    </div>
  );
}
