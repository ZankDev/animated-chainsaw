import { useState, useRef, useCallback, useEffect } from "react";

const STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  ERROR: "error",
  DUPLICATE: "duplicate",
};

const CONCURRENT_LIMIT = 1;

const USD_ILS_RATES = {
  1: 3.61, 2: 3.55, 3: 3.65, 4: 3.69, 5: 3.56, 6: 3.47,
  7: 3.35, 8: 3.38, 9: 3.34, 10: 3.29, 11: 3.26, 12: 3.20,
};

function convertUsdToIls(result) {
  if (!result || !result.amount || !result.date) return null;

  const amountStr = result.amount.trim();
  const isDollar = amountStr.includes("$") || amountStr.toLowerCase().includes("usd");
  if (!isDollar) return null;

  // Extract numeric value
  const num = parseFloat(amountStr.replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return null;

  // Extract month from date (supports DD/MM/YYYY, YYYY-MM-DD, etc.)
  let month = null;
  const dmyMatch = result.date.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmyMatch) {
    // Try DD/MM/YYYY first
    const possibleMonth = parseInt(dmyMatch[2], 10);
    if (possibleMonth >= 1 && possibleMonth <= 12) {
      month = possibleMonth;
    } else {
      // Maybe MM/DD/YYYY
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
  // Extract just the numeric value: remove currency symbols, letters, spaces
  const num = parseFloat(amount.replace(/[^0-9.\-]/g, ""));
  return isNaN(num) ? amount.trim().toLowerCase() : num.toFixed(2);
}

function hashRecord(rec) {
  return `${(rec.date || "").trim()}|${(rec.supplier || "").trim().toLowerCase()}|${normalizeAmount(rec.amount)}|${(rec.reference || "").trim().toLowerCase()}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
  const map = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] || file.type || "application/octet-stream";
}

async function processFileWithClaude(file, retries = 6) {
  const base64Data = await fileToBase64(file);
  const mediaType = getMediaType(file);
  const isPdf = mediaType === "application/pdf";

  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                contentBlock,
                {
                  type: "text",
                  text: `You are a document data extractor for financial documents (invoices, receipts, etc.).
Extract the following fields from this document. Respond ONLY with a JSON object, no markdown, no backticks, no extra text.

Required fields:
- "date": the document date (format: DD/MM/YYYY if possible)
- "supplier": the supplier/vendor name
- "amount": the total amount (number with currency symbol, e.g. "₪1,234.56")
- "reference": reference number / invoice number / receipt number / אסמכתא
- "description": very brief description of what this document is (max 10 words)

If a field cannot be found, use "N/A".

JSON only:`,
                },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 2000));
          continue;
        }
        throw new Error("Timeout - הבקשה נתקעה, נסה שוב");
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (response.status === 429) {
      if (attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 5000 + Math.random() * 3000;
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }
      throw new Error("Rate limit - נסה שוב מאוחר יותר");
    }

    if (!response.ok) {
      const errText = await response.text();
      if (response.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      throw new Error(`API error ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const clean = text.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(clean);
    } catch {
      throw new Error("Failed to parse response: " + text.substring(0, 200));
    }
  }
}

function ProgressBar({ value, max, color = "var(--accent)" }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ width: "100%", height: 8, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 4,
          background: color,
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    [STATUS.PENDING]: { label: "ממתין", bg: "#3a3a4a", color: "#aaa" },
    [STATUS.PROCESSING]: { label: "מעבד...", bg: "#1a3a5c", color: "#5ba3e6" },
    [STATUS.DONE]: { label: "הושלם", bg: "#1a3c2a", color: "#4ade80" },
    [STATUS.ERROR]: { label: "שגיאה", bg: "#3c1a1a", color: "#f87171" },
    [STATUS.DUPLICATE]: { label: "כפול", bg: "#3c3a1a", color: "#fbbf24" },
  };
  const c = config[status] || config[STATUS.PENDING];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
        letterSpacing: 0.3,
      }}
    >
      {c.label}
    </span>
  );
}

function FileRow({ item, index }) {
  const conversion = item.result ? convertUsdToIls(item.result) : null;
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)" }}>{index + 1}</td>
      <td style={{ padding: "10px 12px", fontSize: 13, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr" }} title={item.file.webkitRelativePath || item.file.name}>{item.file.webkitRelativePath || item.file.name}</td>
      <td style={{ padding: "10px 12px" }}><StatusBadge status={item.status} /></td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.date || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13 }}>{item.result?.supplier || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13, direction: "ltr", textAlign: "right" }}>{item.result?.amount || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13, direction: "ltr", textAlign: "right" }}>
        {conversion ? (
          <span title={`$${conversion.usdAmount} × ${conversion.rate} (חודש ${conversion.month})`}>
            <span style={{ color: "#4ade80" }}>₪{conversion.ilsAmount}</span>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", marginRight: 4 }}> ({conversion.rate})</span>
          </span>
        ) : "—"}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 13, direction: "ltr" }}>{item.result?.reference || "—"}</td>
      <td style={{ padding: "10px 12px", fontSize: 13, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.result?.description || "—"}</td>
      {item.status === STATUS.ERROR && (
        <td style={{ padding: "10px 12px", fontSize: 11, color: "#f87171", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.error}</td>
      )}
    </tr>
  );
}

export default function DocumentProcessor() {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState("all");
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);
  const processingRef = useRef(false);
  const seenHashesRef = useRef(new Set());

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

  // Recursively read all files from a directory entry
  const readEntryRecursive = useCallback((entry) => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((f) => resolve([f]), () => resolve([]));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const allEntries = [];
        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) {
              const nested = await Promise.all(allEntries.map(readEntryRecursive));
              resolve(nested.flat());
            } else {
              allEntries.push(...entries);
              readBatch();
            }
          }, () => resolve([]));
        };
        readBatch();
      } else {
        resolve([]);
      }
    });
  }, []);

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setDragOver(false);

      const items = e.dataTransfer.items;
      if (items) {
        const entries = [];
        for (let i = 0; i < items.length; i++) {
          const entry = items[i].webkitGetAsEntry?.() || items[i].getAsEntry?.();
          if (entry) entries.push(entry);
        }
        if (entries.length > 0) {
          const allFiles = (await Promise.all(entries.map(readEntryRecursive))).flat();
          if (allFiles.length > 0) {
            addFiles(allFiles);
            return;
          }
        }
      }
      // Fallback for browsers without entry API
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles, readEntryRecursive]
  );

  // Keep a ref mirror of files for synchronous access
  const filesRef = useRef([]);
  useEffect(() => { filesRef.current = files; }, [files]);

  const processAll = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    seenHashesRef.current = new Set();

    // Reset non-done items and pre-populate seen hashes
    setFiles((prev) => {
      const updated = prev.map((f) =>
        f.status === STATUS.DONE || f.status === STATUS.DUPLICATE
          ? f
          : { ...f, status: STATUS.PENDING, result: null, error: null }
      );
      updated.forEach((f) => {
        if (f.status === STATUS.DONE && f.result) {
          seenHashesRef.current.add(hashRecord(f.result));
        }
      });
      filesRef.current = updated;
      return updated;
    });

    // Wait for state to settle
    await new Promise((r) => setTimeout(r, 150));

    // Collect pending IDs synchronously from ref
    const pendingIds = filesRef.current
      .filter((f) => f.status === STATUS.PENDING)
      .map((f) => f.id);

    if (pendingIds.length === 0) {
      processingRef.current = false;
      setIsProcessing(false);
      return;
    }

    // Semaphore-based concurrent processing
    let nextIndex = 0;

    const processNext = async (workerNum) => {
      // Stagger worker starts
      await new Promise((r) => setTimeout(r, workerNum * 500));

      while (nextIndex < pendingIds.length) {
        const idx = nextIndex++;
        const itemId = pendingIds[idx];

        // Get file from ref synchronously
        const item = filesRef.current.find((f) => f.id === itemId);
        if (!item || !item.file) continue;
        const file = item.file;

        // Mark as processing
        setFiles((prev) => {
          const updated = prev.map((f) =>
            f.id === itemId ? { ...f, status: STATUS.PROCESSING } : f
          );
          filesRef.current = updated;
          return updated;
        });

        try {
          const result = await processFileWithClaude(file);
          const h = hashRecord(result);
          const isDuplicate = seenHashesRef.current.has(h);
          if (!isDuplicate) seenHashesRef.current.add(h);

          setFiles((prev) => {
            const updated = prev.map((f) =>
              f.id === itemId
                ? { ...f, status: isDuplicate ? STATUS.DUPLICATE : STATUS.DONE, result }
                : f
            );
            filesRef.current = updated;
            return updated;
          });
        } catch (err) {
          setFiles((prev) => {
            const updated = prev.map((f) =>
              f.id === itemId ? { ...f, status: STATUS.ERROR, error: err.message } : f
            );
            filesRef.current = updated;
            return updated;
          });
        }

        // Cooldown between requests to avoid rate limits
        await new Promise((r) => setTimeout(r, 2000));
      }
    };

    // Launch CONCURRENT_LIMIT workers
    const workers = Array.from({ length: Math.min(CONCURRENT_LIMIT, pendingIds.length) }, (_, i) => processNext(i));
    await Promise.all(workers);

    processingRef.current = false;
    setIsProcessing(false);
  }, []);

  const exportCSV = useCallback(() => {
    const done = files.filter((f) => f.status === STATUS.DONE || f.status === STATUS.DUPLICATE);
    if (!done.length) return;

    const BOM = "\uFEFF";
    const header = ["#", "קובץ", "סטטוס", "תאריך", "ספק", "סכום מקורי", "סכום ₪", "שער", "אסמכתא", "תיאור"];
    const rows = done.map((f, i) => {
      const conv = f.result ? convertUsdToIls(f.result) : null;
      return [
        i + 1,
        f.file.webkitRelativePath || f.file.name,
        f.status === STATUS.DUPLICATE ? "כפול" : "תקין",
        f.result?.date || "",
        f.result?.supplier || "",
        f.result?.amount || "",
        conv ? `₪${conv.ilsAmount}` : f.result?.amount || "",
        conv ? conv.rate : "",
        f.result?.reference || "",
        f.result?.description || "",
      ];
    });

    const csv = BOM + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    
    // Also create TSV for easy Excel paste
    const tsv = [header, ...rows].map((r) => r.map((c) => String(c).replace(/\t/g, " ")).join("\t")).join("\n");
    
    setExportData({ csv, tsv, count: done.length });
  }, [files]);

  const [exportData, setExportData] = useState(null);

  const clearAll = () => {
    if (isProcessing) return;
    setFiles([]);
    seenHashesRef.current.clear();
  };

  const retryFailed = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    // Reset only error items to pending
    setFiles((prev) => {
      const updated = prev.map((f) =>
        f.status === STATUS.ERROR ? { ...f, status: STATUS.PENDING, error: null } : f
      );
      // Re-populate seen hashes from done items
      seenHashesRef.current = new Set();
      updated.forEach((f) => {
        if ((f.status === STATUS.DONE || f.status === STATUS.DUPLICATE) && f.result) {
          seenHashesRef.current.add(hashRecord(f.result));
        }
      });
      filesRef.current = updated;
      return updated;
    });

    await new Promise((r) => setTimeout(r, 150));

    const pendingIds = filesRef.current
      .filter((f) => f.status === STATUS.PENDING)
      .map((f) => f.id);

    if (pendingIds.length === 0) {
      processingRef.current = false;
      setIsProcessing(false);
      return;
    }

    let nextIndex = 0;
    const processNext = async (workerNum) => {
      await new Promise((r) => setTimeout(r, workerNum * 500));
      while (nextIndex < pendingIds.length) {
        const idx = nextIndex++;
        const itemId = pendingIds[idx];
        const item = filesRef.current.find((f) => f.id === itemId);
        if (!item || !item.file) continue;
        const file = item.file;

        setFiles((prev) => {
          const updated = prev.map((f) =>
            f.id === itemId ? { ...f, status: STATUS.PROCESSING } : f
          );
          filesRef.current = updated;
          return updated;
        });

        try {
          const result = await processFileWithClaude(file);
          const h = hashRecord(result);
          const isDuplicate = seenHashesRef.current.has(h);
          if (!isDuplicate) seenHashesRef.current.add(h);

          setFiles((prev) => {
            const updated = prev.map((f) =>
              f.id === itemId
                ? { ...f, status: isDuplicate ? STATUS.DUPLICATE : STATUS.DONE, result }
                : f
            );
            filesRef.current = updated;
            return updated;
          });
        } catch (err) {
          setFiles((prev) => {
            const updated = prev.map((f) =>
              f.id === itemId ? { ...f, status: STATUS.ERROR, error: err.message } : f
            );
            filesRef.current = updated;
            return updated;
          });
        }

        await new Promise((r) => setTimeout(r, 2000));
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENT_LIMIT, pendingIds.length) }, (_, i) => processNext(i));
    await Promise.all(workers);

    processingRef.current = false;
    setIsProcessing(false);
  }, []);

  const filteredFiles = files.filter((f) => {
    if (filter === "all") return true;
    if (filter === "duplicates") return f.status === STATUS.DUPLICATE;
    if (filter === "errors") return f.status === STATUS.ERROR;
    if (filter === "done") return f.status === STATUS.DONE;
    return true;
  });

  const accentGreen = "#4ade80";
  const accentYellow = "#fbbf24";
  const accentRed = "#f87171";
  const accentBlue = "#5ba3e6";

  return (
    <div
      dir="rtl"
      style={{
        fontFamily: "'Segoe UI', 'Arial', sans-serif",
        minHeight: "100vh",
        background: "#0d0d12",
        color: "#e0e0e8",
        padding: 0,
        "--bg-primary": "#0d0d12",
        "--bg-secondary": "#16161f",
        "--bg-tertiary": "#1e1e2a",
        "--border": "#2a2a3a",
        "--text-primary": "#e0e0e8",
        "--text-secondary": "#8888a0",
        "--accent": "#6366f1",
      }}
    >
      {/* Header */}
      <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            📄
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>מעבד מסמכים חכם</h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
              חילוץ נתונים אוטומטי + זיהוי כפילויות
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px" }}>
        {/* Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? "#6366f1" : "#2a2a3a"}`,
            borderRadius: 16,
            padding: "40px 24px",
            textAlign: "center",
            background: dragOver ? "rgba(99,102,241,0.08)" : "var(--bg-secondary)",
            transition: "all 0.3s ease",
            marginBottom: 24,
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            webkitdirectory=""
            directory=""
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
          <div style={{ fontSize: 42, marginBottom: 12 }}>
            {dragOver ? "📥" : "📎"}
          </div>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            {dragOver ? "שחרר כאן — גם תיקיות!" : "גרור קבצים או תיקיות לכאן"}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
            PDF, JPG, PNG, WebP • ללא הגבלת כמות • כולל תיקיות מקוננות
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              📄 בחר קבצים
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "1px solid #6366f1",
                background: "rgba(99,102,241,0.12)",
                color: "#a5b4fc",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              📁 בחר תיקייה
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        {files.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                { label: "סה״כ", value: stats.total, color: "var(--accent)" },
                { label: "הושלם", value: stats.done, color: accentGreen },
                { label: "כפולים", value: stats.duplicates, color: accentYellow },
                { label: "שגיאות", value: stats.errors, color: accentRed },
                { label: "בעיבוד", value: stats.processing + stats.pending, color: accentBlue },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: "var(--bg-secondary)",
                    borderRadius: 10,
                    padding: "10px 18px",
                    minWidth: 80,
                    textAlign: "center",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Progress */}
            {isProcessing && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  <span>מעבד... {stats.done + stats.duplicates + stats.errors} / {stats.total}</span>
                  <span>{Math.round(((stats.done + stats.duplicates + stats.errors) / stats.total) * 100)}%</span>
                </div>
                <ProgressBar value={stats.done + stats.duplicates + stats.errors} max={stats.total} />
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={processAll}
                disabled={isProcessing || stats.pending === 0 && stats.errors === 0}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "none",
                  background: isProcessing ? "#2a2a3a" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: isProcessing ? "#666" : "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {isProcessing ? `⏳ מעבד... (${CONCURRENT_LIMIT} במקביל)` : "▶️ התחל עיבוד"}
              </button>

              <button
                onClick={exportCSV}
                disabled={stats.done + stats.duplicates === 0}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-secondary)",
                  color: stats.done + stats.duplicates > 0 ? accentGreen : "#444",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: stats.done + stats.duplicates > 0 ? "pointer" : "not-allowed",
                }}
              >
                📊 ייצוא CSV
              </button>

              {stats.errors > 0 && (
                <button
                  onClick={retryFailed}
                  disabled={isProcessing}
                  style={{
                    padding: "10px 24px",
                    borderRadius: 10,
                    border: "1px solid #f59e0b",
                    background: "rgba(245,158,11,0.1)",
                    color: isProcessing ? "#444" : accentYellow,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isProcessing ? "not-allowed" : "pointer",
                  }}
                >
                  🔄 נסה שוב שגיאות ({stats.errors})
                </button>
              )}

              <button
                onClick={clearAll}
                disabled={isProcessing}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-secondary)",
                  color: isProcessing ? "#444" : accentRed,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
              >
                🗑️ נקה הכל
              </button>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        {files.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[
              { key: "all", label: `הכל (${stats.total})` },
              { key: "done", label: `תקינים (${stats.done})` },
              { key: "duplicates", label: `כפולים (${stats.duplicates})` },
              { key: "errors", label: `שגיאות (${stats.errors})` },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: filter === t.key ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: filter === t.key ? "rgba(99,102,241,0.15)" : "transparent",
                  color: filter === t.key ? "#a5b4fc" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Results Table */}
        {filteredFiles.length > 0 && (
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--bg-secondary)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg-tertiary)" }}>
                    {["#", "קובץ", "סטטוס", "תאריך", "ספק", "סכום", "סכום ₪", "אסמכתא", "תיאור"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.map((item, i) => (
                    <FileRow key={item.id} item={item} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {files.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📋</div>
            <p style={{ fontSize: 15, margin: 0 }}>העלה מסמכים כדי להתחיל</p>
            <p style={{ fontSize: 13, margin: "8px 0 0", opacity: 0.7 }}>חשבוניות, קבלות, אישורי תשלום — הכל עובד</p>
          </div>
        )}
      </div>

      {/* Export Modal */}
      {exportData && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 20,
          }}
          onClick={() => setExportData(null)}
        >
          <div
            style={{
              background: "#1a1a2e",
              borderRadius: 16,
              border: "1px solid var(--border)",
              padding: 28,
              maxWidth: 600,
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📊 ייצוא נתונים ({exportData.count} מסמכים)</h2>
              <button
                onClick={() => setExportData(null)}
                style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer" }}
              >✕</button>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
              בחר שיטה להעתקת הנתונים:
            </p>

            {/* TSV - paste into Excel */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>📋 הדבק ישירות לאקסל</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(exportData.tsv); }}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 8,
                    border: "1px solid #4ade80",
                    background: "rgba(74,222,128,0.1)",
                    color: "#4ade80",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  העתק טבלה
                </button>
              </div>
              <textarea
                readOnly
                value={exportData.tsv}
                style={{
                  width: "100%",
                  height: 120,
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 11,
                  fontFamily: "monospace",
                  padding: 10,
                  resize: "vertical",
                  direction: "ltr",
                }}
              />
            </div>

            {/* CSV */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>📄 CSV (לייבוא לתוכנות)</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(exportData.csv); }}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 8,
                    border: "1px solid #6366f1",
                    background: "rgba(99,102,241,0.1)",
                    color: "#a5b4fc",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  העתק CSV
                </button>
              </div>
              <textarea
                readOnly
                value={exportData.csv}
                style={{
                  width: "100%",
                  height: 120,
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 11,
                  fontFamily: "monospace",
                  padding: 10,
                  resize: "vertical",
                  direction: "ltr",
                }}
              />
            </div>

            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
              💡 טיפ: "העתק טבלה" → פתח אקסל → Ctrl+V — והנתונים נכנסים ישר לתאים
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
