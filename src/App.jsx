import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

// ─── WebCrypto E2EE ───────────────────────────────────────────────────────────
async function deriveKey(roomCode) {
  const raw = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(roomCode.toUpperCase()), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode("vaultchat-v1-salt"), iterations: 200000, hash: "SHA-256" },
    raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
async function encryptText(key, pt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(pt));
  const b = new Uint8Array(12 + ct.byteLength); b.set(iv); b.set(new Uint8Array(ct), 12);
  let s = ""; const chunk = 8192;
  for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode(...b.subarray(i, i + chunk));
  return btoa(s);
}
async function decryptText(key, b64) {
  try {
    const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12));
    return new TextDecoder().decode(p);
  } catch { return null; }
}
async function encryptBytes(key, ab) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ab);
  const b = new Uint8Array(12 + ct.byteLength); b.set(iv); b.set(new Uint8Array(ct), 12);
  let s = ""; const chunk = 8192;
  for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode(...b.subarray(i, i + chunk));
  return btoa(s);
}
async function decryptToBlob(key, b64, mimeType) {
  try {
    const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12));
    return new Blob([p], { type: mimeType });
  } catch { return null; }
}
function genCode() {
  const C = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => C[b % C.length]).join("");
}
function fileToAB(file) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsArrayBuffer(file);
  });
}

// ─── Supabase Storage Helpers ─────────────────────────────────────────────────
async function saveMedia(code, id, b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const { error } = await supabase.storage
    .from("media")
    .upload(`${code}/${id}`, blob, { upsert: true });
  if (error) throw error;
}

async function loadMedia(code, id) {
  try {
    const { data } = supabase.storage.from("media").getPublicUrl(`${code}/${id}`);
    const resp = await fetch(data.publicUrl);
    const ab = await resp.arrayBuffer();
    let s = "";
    const bytes = new Uint8Array(ab);
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk)
      s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(s);
  } catch { return null; }
}

async function saveSingleMsg(code, msg) {
  const { error } = await supabase.from("messages").insert({
    id: msg.id,
    room_code: code,
    type: msg.type || "text",
    sender: msg.sender,
    ciphertext: msg.ciphertext || null,
    media_id: msg.mediaId || null,
    mime_type: msg.mimeType || null,
    file_name: msg.fileName || null,
    file_size: msg.fileSize || null,
    ts: msg.ts,
  });
  if (error) throw error;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AC = ["#7C6FFF","#FF6B9D","#00D4AA","#FFB347","#6E7EFF","#00C8E0","#FF7B54","#90EE90"];
const aColor = n => { let h = 0; for (const c of (n || "")) h = (h * 31 + c.charCodeAt(0)) % AC.length; return AC[h]; };
const initials = n => (n || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtSize = b => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const MAX_BYTES = 4 * 1024 * 1024;

function getFileIcon(mime, name) {
  if (!mime && name) {
    const ext = name.split(".").pop().toLowerCase();
    if (["pdf"].includes(ext)) return { icon: "📄", color: "#FF6B6B", label: "PDF" };
    if (["doc", "docx"].includes(ext)) return { icon: "📝", color: "#4DA6FF", label: "DOC" };
    if (["xls", "xlsx"].includes(ext)) return { icon: "📊", color: "#51CF66", label: "XLS" };
    if (["ppt", "pptx"].includes(ext)) return { icon: "📑", color: "#FF9F43", label: "PPT" };
    if (["zip", "rar", "7z"].includes(ext)) return { icon: "🗜", color: "#A78BFA", label: "ZIP" };
    if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return { icon: "🎵", color: "#F472B6", label: "AUDIO" };
    if (["txt", "md", "csv"].includes(ext)) return { icon: "📃", color: "#94A3B8", label: ext.toUpperCase() };
    return { icon: "📎", color: "#94A3B8", label: ext.toUpperCase() };
  }
  if (mime?.startsWith("image/")) return { icon: "🖼", color: "#7C6FFF", label: "IMG" };
  if (mime?.startsWith("video/")) return { icon: "🎥", color: "#FF6B9D", label: "VIDEO" };
  if (mime?.includes("pdf")) return { icon: "📄", color: "#FF6B6B", label: "PDF" };
  if (mime?.includes("word") || mime?.includes("document")) return { icon: "📝", color: "#4DA6FF", label: "DOC" };
  if (mime?.includes("sheet") || mime?.includes("excel")) return { icon: "📊", color: "#51CF66", label: "XLS" };
  if (mime?.includes("presentation") || mime?.includes("powerpoint")) return { icon: "📑", color: "#FF9F43", label: "PPT" };
  if (mime?.includes("zip") || mime?.includes("compressed")) return { icon: "🗜", color: "#A78BFA", label: "ZIP" };
  if (mime?.startsWith("audio/")) return { icon: "🎵", color: "#F472B6", label: "AUDIO" };
  if (mime?.startsWith("text/")) return { icon: "📃", color: "#94A3B8", label: "TXT" };
  return { icon: "📎", color: "#94A3B8", label: "FILE" };
}

// ─── Media/File Bubble ────────────────────────────────────────────────────────
function AttachBubble({ msg, roomCode, cryptoKey, mine }) {
  const [blob, setBlob] = useState(null);
  const [objUrl, setObjUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(false);
  const isImg = msg.mimeType?.startsWith("image/");
  const isVid = msg.mimeType?.startsWith("video/");
  const isAudio = msg.mimeType?.startsWith("audio/");
  const fileInfo = getFileIcon(msg.mimeType, msg.fileName);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const enc = await loadMedia(roomCode, msg.mediaId);
      if (!enc || cancelled) { setLoading(false); return; }
      const b = await decryptToBlob(cryptoKey, enc, msg.mimeType || "application/octet-stream");
      if (!cancelled && b) { setBlob(b); setObjUrl(URL.createObjectURL(b)); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [msg.mediaId, roomCode, cryptoKey, msg.mimeType]);

  function download() {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = msg.fileName || "file";
    a.click();
  }

  if (loading) return (
    <div className={`vc-file-card ${mine ? "mine" : "theirs"}`}>
      <div className="vc-spinner-sm" />
      <div className="vc-file-info">
        <div className="vc-file-name-text">{msg.fileName}</div>
        <div className="vc-file-size">Decrypting…</div>
      </div>
    </div>
  );

  if (!objUrl) return (
    <div className={`vc-file-card ${mine ? "mine" : "theirs"}`}>
      <span style={{ fontSize: "20px" }}>⚠</span>
      <div className="vc-file-info"><div className="vc-file-name-text">Unavailable</div></div>
    </div>
  );

  if (isImg) return (
    <>
      <img className="vc-media-img" src={objUrl} alt={msg.fileName} onClick={() => setLightbox(true)} />
      {lightbox && (
        <div className="vc-lightbox" onClick={() => setLightbox(false)}>
          <img src={objUrl} alt="full" className="vc-lightbox-img" />
          <div className="vc-lb-actions">
            <button className="vc-lb-dl" onClick={e => { e.stopPropagation(); download(); }}>⬇ Download</button>
            <div className="vc-lightbox-close" onClick={() => setLightbox(false)}>✕</div>
          </div>
        </div>
      )}
    </>
  );

  if (isVid) return <video className="vc-media-video" src={objUrl} controls playsInline />;

  if (isAudio) return (
    <div className={`vc-file-card ${mine ? "mine" : "theirs"}`}>
      <span style={{ fontSize: "24px", minWidth: "32px" }}>{fileInfo.icon}</span>
      <div className="vc-file-info">
        <div className="vc-file-name-text">{msg.fileName}</div>
        <audio controls src={objUrl} style={{ marginTop: "6px", width: "160px", height: "28px" }} />
        <div className="vc-file-size">{fmtSize(msg.fileSize)}</div>
      </div>
    </div>
  );

  return (
    <div className={`vc-file-card ${mine ? "mine" : "theirs"}`} onClick={download} style={{ cursor: "pointer" }}>
      <div className="vc-file-icon-box" style={{ background: fileInfo.color + "20", color: fileInfo.color }}>
        <span style={{ fontSize: "22px" }}>{fileInfo.icon}</span>
        <span className="vc-file-ext">{fileInfo.label}</span>
      </div>
      <div className="vc-file-info">
        <div className="vc-file-name-text">{msg.fileName}</div>
        <div className="vc-file-size">{fmtSize(msg.fileSize)}</div>
        <div className="vc-dl-hint">Tap to download 🔒</div>
      </div>
      <div className="vc-dl-arrow">⬇</div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function VaultChat() {
  const [screen, setScreen] = useState("home");
  const [joinInput, setJoinInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [pendingCode, setPendingCode] = useState("");
  const [setupMode, setSetupMode] = useState("create");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [cryptoKey, setCryptoKey] = useState(null);
  const [status, setStatus] = useState("idle");
  const [copied, setCopied] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const [typing, setTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [preview, setPreview] = useState(null);
  const [showAttach, setShowAttach] = useState(false);
  const [prevScreen, setPrevScreen] = useState("home");

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const channelRef = useRef(null);
  const typingTimer = useRef(null);
  const cryptoKeyRef = useRef(null);
  cryptoKeyRef.current = cryptoKey;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function navigate(to) {
    setPrevScreen(screen);
    setScreen(to);
  }

  async function enterRoom(code, name) {
    setStatus("deriving");
    try {
      const key = await deriveKey(code);
      const upperCode = code.toUpperCase();

      const { data: existing, error } = await supabase
        .from("messages")
        .select("*")
        .eq("room_code", upperCode)
        .order("ts");

      if (error) throw error;

      const mapped = (existing || []).map(row => ({
        id: row.id, type: row.type, sender: row.sender,
        ciphertext: row.ciphertext, mediaId: row.media_id,
        mimeType: row.mime_type, fileName: row.file_name,
        fileSize: row.file_size, ts: row.ts,
      }));

      const dec = await Promise.all(mapped.map(async m => {
        if (m.type === "media") return { ...m };
        return { ...m, text: await decryptText(key, m.ciphertext) || "⚠ [decryption failed]" };
      }));

      setMessages(dec);
      setCryptoKey(key);
      setRoomCode(upperCode);
      setUsername(name);

      const channel = supabase.channel(`room-${upperCode}`, {
        config: { presence: { key: name } },
      })
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `room_code=eq.${upperCode}` },
          async (payload) => {
            const row = payload.new;
            const m = {
              id: row.id, type: row.type, sender: row.sender,
              ciphertext: row.ciphertext, mediaId: row.media_id,
              mimeType: row.mime_type, fileName: row.file_name,
              fileSize: row.file_size, ts: row.ts,
            };
            const decoded = m.type === "media"
              ? { ...m }
              : { ...m, text: await decryptText(cryptoKeyRef.current, m.ciphertext) || "⚠ [decryption failed]" };
            setMessages(prev =>
              prev.find(x => x.id === decoded.id) ? prev : [...prev, decoded]
            );
          }
        )
        .on("broadcast", { event: "typing" }, (payload) => {
          if (payload.payload.name !== name) {
            setTyping(true);
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setTyping(false), 3000);
          }
        })
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState();
          setOnlineCount(Math.max(1, Object.keys(state).length));
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await channel.track({ name, online_at: new Date().toISOString() });
          }
        });

      channelRef.current = channel;
      setStatus("ready");
      navigate("chat");
      setTimeout(() => inputRef.current?.focus(), 200);
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  function handleCreate() { const c = genCode(); setPendingCode(c); setSetupMode("create"); navigate("setup"); }
  function handleJoin() { if (joinInput.trim().length < 4) return; setPendingCode(joinInput.trim().toUpperCase()); setSetupMode("join"); navigate("setup"); }
  async function handleEnter() { if (usernameInput.trim().length < 2) return; await enterRoom(pendingCode, usernameInput.trim()); }

  async function sendText() {
    if (!input.trim() || !cryptoKey || !roomCode) return;
    const text = input.trim();
    setInput("");
    const cipher = await encryptText(cryptoKey, text);
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "text", sender: username, ciphertext: cipher, ts: Date.now(),
    };
    setMessages(prev => [...prev, { ...msg, text }]);
    try { await saveSingleMsg(roomCode, msg); } catch (e) { console.error("send failed", e); }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > MAX_BYTES) { alert(`File too large (max 4 MB).\nYour file: ${fmtSize(file.size)}`); return; }
    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");
    if (isImg || isVid) {
      const reader = new FileReader();
      reader.onload = ev => setPreview({ previewSrc: ev.target.result, file });
      reader.readAsDataURL(file);
    } else {
      setPreview({ previewSrc: null, file });
    }
    setShowAttach(false);
  }

  async function sendFile(file) {
    if (!file || !cryptoKey || !roomCode) return;
    setUploading(true);
    setUploadProgress("Reading file…");
    try {
      const ab = await fileToAB(file);
      setUploadProgress("Encrypting…");
      const encB64 = await encryptBytes(cryptoKey, ab);
      const mediaId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploadProgress("Uploading…");
      await saveMedia(roomCode, mediaId, encB64);
      const msg = {
        id: mediaId, type: "media", sender: username,
        mediaId, mimeType: file.type, fileName: file.name, fileSize: file.size, ts: Date.now(),
      };
      setMessages(prev => [...prev, { ...msg }]);
      setUploadProgress("Saving…");
      await saveSingleMsg(roomCode, msg);
    } catch (e) {
      alert("Failed to send: " + e.message);
    } finally {
      setUploading(false); setUploadProgress(""); setPreview(null); setShowAttach(false);
    }
  }

  async function handleTyping() {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: "broadcast", event: "typing", payload: { name: username },
    });
  }

  async function copyCode() {
    await navigator.clipboard.writeText(pendingCode || roomCode).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  }

  function leaveRoom() {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    clearTimeout(typingTimer.current);
    navigate("home"); setMessages([]); setRoomCode(""); setCryptoKey(null);
    setUsername(""); setInput(""); setJoinInput(""); setUsernameInput("");
    setStatus("idle"); setPreview(null); setShowAttach(false);
    setOnlineCount(1); setTyping(false);
  }

  const grouped = [];
  let lastDay = null;
  for (const m of messages) {
    const day = new Date(m.ts).toLocaleDateString([], { month: "short", day: "numeric" });
    if (day !== lastDay) { grouped.push({ type: "day", label: day }); lastDay = day; }
    grouped.push({ type: "msg", ...m });
  }

  const ATTACH_OPTIONS = [
    { label: "Image", icon: "🖼", accept: "image/*", bg: "#EDE9FF", color: "#7C6FFF" },
    { label: "Video", icon: "🎥", accept: "video/*", bg: "#FFE8F0", color: "#FF6B9D" },
    { label: "PDF", icon: "📄", accept: ".pdf,application/pdf", bg: "#FFE8E8", color: "#FF6B6B" },
    { label: "Document", icon: "📝", accept: ".doc,.docx,.odt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document", bg: "#E8F4FF", color: "#4DA6FF" },
    { label: "Spreadsheet", icon: "📊", accept: ".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bg: "#E8FFF1", color: "#51CF66" },
    { label: "Audio", icon: "🎵", accept: "audio/*", bg: "#FFE8F8", color: "#F472B6" },
    { label: "Archive", icon: "🗜", accept: ".zip,.rar,.7z,application/zip,application/x-rar-compressed", bg: "#EDE8FF", color: "#A78BFA" },
    { label: "Any File", icon: "📎", accept: "*", bg: "#F0F4FF", color: "#94A3B8" },
  ];

  const previewFileInfo = preview?.file ? getFileIcon(preview.file.type, preview.file.name) : null;

  return (
    <div className="vc-app">
      <style>{CSS}</style>
      <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFileSelect} />

      {/* ── HOME ── */}
      {screen === "home" && (
        <div className="vc-page vc-slide-up">
          <div className="vc-bg-orbs">
            <div className="vc-orb vc-orb1" />
            <div className="vc-orb vc-orb2" />
            <div className="vc-orb vc-orb3" />
          </div>
          <div className="vc-card">
            <div className="vc-home-top">
              <div>
                <p className="vc-greet">Welcome back</p>
                <h1 className="vc-brand">VaultChat<span className="vc-brand-dot">.</span></h1>
              </div>
              <div className="vc-lock-badge">
                <span className="vc-lock-icon">🔒</span>
              </div>
            </div>

            <button className="vc-primary-btn" onClick={handleCreate}>
              <div className="vc-btn-icon-wrap">
                <div className="vc-btn-icon">＋</div>
              </div>
              <div className="vc-btn-text">
                <div className="vc-btn-title">New Secure Room</div>
                <div className="vc-btn-sub">Generate encrypted room code</div>
              </div>
              <div className="vc-btn-arrow">→</div>
            </button>

            <div className="vc-or">
              <div className="vc-or-line" />
              <span className="vc-or-text">or join existing</span>
              <div className="vc-or-line" />
            </div>

            <div className="vc-join-row">
              <input className="vc-code-input" placeholder="ENTER CODE" value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase().slice(0, 6))}
                onKeyDown={e => e.key === "Enter" && handleJoin()} maxLength={6} />
              <button className={`vc-join-btn ${joinInput.length >= 4 ? "active" : ""}`} onClick={handleJoin} disabled={joinInput.length < 4}>
                <span className="vc-join-arrow">→</span>
              </button>
            </div>

            <div className="vc-feature-chips">
              {[["🔐", "E2EE", "#EDE9FF", "#7C6FFF"], ["🖼", "Images", "#FFE8F0", "#FF6B9D"], ["🎥", "Videos", "#E8FFF1", "#51CF66"], ["📄", "Files", "#FFF4E8", "#FF9F43"]].map(([e, t, bg, col]) => (
                <div key={t} className="vc-chip" style={{ background: bg }}>
                  <span className="vc-chip-icon">{e}</span>
                  <span className="vc-chip-label" style={{ color: col }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SETUP ── */}
      {screen === "setup" && (
        <div className="vc-page vc-slide-up">
          <div className="vc-bg-orbs">
            <div className="vc-orb vc-orb1" />
            <div className="vc-orb vc-orb2" />
          </div>
          <div className="vc-card">
            <button className="vc-back" onClick={() => navigate("home")}>
              <span className="vc-back-arrow">←</span> Back
            </button>

            {setupMode === "create" ? (
              <>
                <div className="vc-setup-header">
                  <h2 className="vc-setup-title">Your Room Code</h2>
                  <p className="vc-setup-sub">Share this with who you want to chat with</p>
                </div>
                <div className="vc-code-display">
                  <div className="vc-code-glow" />
                  <div className="vc-code-letters">
                    {pendingCode.split("").map((ch, i) => (
                      <span key={i} className="vc-code-char" style={{ animationDelay: `${i * 60}ms` }}>{ch}</span>
                    ))}
                  </div>
                  <button className="vc-copy-btn" onClick={copyCode}>
                    {copied ? <><span>✓</span> Copied!</> : <><span>⎘</span> Copy</>}
                  </button>
                </div>
                <div className="vc-code-hint">
                  <span className="vc-hint-icon">🔑</span>
                  This code IS your encryption key. Keep it private — anyone with it can join.
                </div>
              </>
            ) : (
              <>
                <div className="vc-setup-header">
                  <h2 className="vc-setup-title">Joining Room</h2>
                  <p className="vc-setup-sub">Connecting to encrypted room</p>
                </div>
                <div className="vc-code-display">
                  <div className="vc-code-glow" />
                  <div className="vc-code-letters">
                    {pendingCode.split("").map((ch, i) => (
                      <span key={i} className="vc-code-char" style={{ animationDelay: `${i * 60}ms` }}>{ch}</span>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="vc-name-sec">
              <label className="vc-name-label">Display name</label>
              <input className="vc-name-input" placeholder="What should we call you?" value={usernameInput}
                onChange={e => setUsernameInput(e.target.value.slice(0, 20))}
                onKeyDown={e => e.key === "Enter" && handleEnter()} autoFocus />
            </div>

            <button className={`vc-primary-btn ${usernameInput.trim().length < 2 || status === "deriving" ? "disabled" : ""}`}
              onClick={handleEnter} disabled={usernameInput.trim().length < 2 || status === "deriving"}>
              <div className="vc-btn-icon-wrap">
                <div className="vc-btn-icon">
                  {status === "deriving" ? <div className="vc-spinner-inline" /> : "💬"}
                </div>
              </div>
              <div className="vc-btn-text">
                <div className="vc-btn-title">{status === "deriving" ? "Connecting…" : "Enter Chat"}</div>
                <div className="vc-btn-sub">End-to-end encrypted</div>
              </div>
              {status !== "deriving" && <div className="vc-btn-arrow">→</div>}
            </button>

            {status === "error" && (
              <p className="vc-err">
                <span>⚠</span> Something went wrong. Check your connection and try again.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── CHAT ── */}
      {screen === "chat" && (
        <div className="vc-chat-root vc-slide-up" onClick={() => setShowAttach(false)}>
          {/* Header */}
          <div className="vc-chat-header">
            <button className="vc-hdr-back" onClick={leaveRoom}>←</button>
            <div className="vc-hdr-avatar" style={{ background: aColor(roomCode) }}>
              {roomCode.slice(0, 2)}
            </div>
            <div className="vc-hdr-info">
              <div className="vc-hdr-name">
                <span className="vc-hdr-room">Room</span>
                <span className="vc-hdr-code">{roomCode}</span>
              </div>
              <div className="vc-hdr-status">
                {typing
                  ? <><span className="vc-dot green pulse" />typing…</>
                  : onlineCount > 1
                    ? <><span className="vc-dot green pulse" />{onlineCount} online</>
                    : <><span className="vc-dot gray" />Waiting for others</>
                }
              </div>
            </div>
            <button className="vc-share-btn" onClick={e => { e.stopPropagation(); copyCode(); }}>
              {copied ? "✓ Copied" : "⎘ Share"}
            </button>
          </div>

          {copied && <div className="vc-toast vc-toast-in">Code copied! Share it with your contact.</div>}

          {/* Messages */}
          <div className="vc-messages">
            {grouped.length === 0 && (
              <div className="vc-empty vc-slide-up">
                <div className="vc-empty-icon-wrap">
                  <div className="vc-empty-ring" />
                  <span className="vc-empty-icon">🔐</span>
                </div>
                <div className="vc-empty-title">Secure channel open</div>
                <div className="vc-empty-sub">
                  Share code <strong style={{ color: "#7C6FFF" }}>{roomCode}</strong> to invite someone.<br />
                  Text, images, videos &amp; files are all encrypted.
                </div>
              </div>
            )}

            {grouped.map((item, i) => {
              if (item.type === "day") return (
                <div key={`d${i}`} className="vc-day-div">
                  <div className="vc-day-line" />
                  <span className="vc-day-badge">{item.label}</span>
                  <div className="vc-day-line" />
                </div>
              );
              const mine = item.sender === username;
              return (
                <div key={item.id} className={`vc-msg-row ${mine ? "mine" : "theirs"} vc-msg-in`}
                  style={{ animationDelay: "0ms" }}>
                  {!mine && (
                    <div className="vc-msg-avatar" style={{ background: aColor(item.sender) }}>
                      {initials(item.sender)}
                    </div>
                  )}
                  <div className="vc-msg-col">
                    {!mine && <div className="vc-msg-sender">{item.sender}</div>}
                    {item.type === "media" ? (
                      <div className={`vc-bubble media ${mine ? "mine" : "theirs"}`}>
                        <AttachBubble msg={item} roomCode={roomCode} cryptoKey={cryptoKey} mine={mine} />
                      </div>
                    ) : (
                      <div className={`vc-bubble ${mine ? "mine" : "theirs"}`}>{item.text}</div>
                    )}
                    <div className={`vc-msg-time ${mine ? "right" : "left"}`}>{fmtTime(item.ts)}</div>
                  </div>
                </div>
              );
            })}

            {typing && (
              <div className="vc-msg-row theirs vc-msg-in">
                <div className="vc-bubble theirs" style={{ padding: "14px 18px" }}>
                  <div className="vc-typing"><span /><span /><span /></div>
                </div>
              </div>
            )}

            {uploading && (
              <div className="vc-msg-row mine vc-msg-in">
                <div className="vc-bubble mine vc-upload-pill">
                  <div className="vc-spinner-sm" />
                  <span>{uploadProgress}</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} style={{ height: "8px" }} />
          </div>

          {/* File preview overlay */}
          {preview && (
            <div className="vc-preview-overlay vc-fade" onClick={e => e.stopPropagation()}>
              <div className="vc-preview-sheet vc-sheet-up">
                <div className="vc-preview-handle" />
                <div className="vc-preview-title">Send this file?</div>
                {preview.previewSrc && preview.file.type.startsWith("image/") && (
                  <div className="vc-preview-img-wrap">
                    <img src={preview.previewSrc} className="vc-preview-img" alt="preview" />
                  </div>
                )}
                {preview.previewSrc && preview.file.type.startsWith("video/") && (
                  <div className="vc-preview-img-wrap">
                    <video src={preview.previewSrc} className="vc-preview-img" controls />
                  </div>
                )}
                {!preview.previewSrc && previewFileInfo && (
                  <div className="vc-preview-file-icon" style={{ background: previewFileInfo.color + "18" }}>
                    <span style={{ fontSize: "48px" }}>{previewFileInfo.icon}</span>
                    <div className="vc-preview-ext" style={{ color: previewFileInfo.color }}>{previewFileInfo.label}</div>
                  </div>
                )}
                <div className="vc-preview-meta">
                  <div className="vc-preview-fname">{preview.file.name}</div>
                  <div className="vc-preview-fsize">{fmtSize(preview.file.size)} · Encrypted before sending 🔒</div>
                </div>
                <div className="vc-preview-actions">
                  <button className="vc-preview-cancel" onClick={() => setPreview(null)}>Cancel</button>
                  <button className="vc-preview-send" onClick={() => sendFile(preview.file)} disabled={uploading}>
                    {uploading ? <><div className="vc-spinner-sm" /> {uploadProgress}</> : "Send 🔒"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Attach drawer */}
          {showAttach && (
            <div className="vc-attach-drawer vc-drawer-up" onClick={e => e.stopPropagation()}>
              <div className="vc-attach-handle" />
              <div className="vc-attach-grid">
                {ATTACH_OPTIONS.map((opt, idx) => (
                  <button key={opt.label} className="vc-attach-item"
                    style={{ animationDelay: `${idx * 30}ms` }}
                    onClick={() => {
                      if (fileRef.current) { fileRef.current.accept = opt.accept; fileRef.current.click(); }
                      setShowAttach(false);
                    }}>
                    <div className="vc-attach-icon-box" style={{ background: opt.bg, color: opt.color }}>
                      {opt.icon}
                    </div>
                    <span className="vc-attach-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input bar */}
          <div className="vc-input-bar" onClick={e => e.stopPropagation()}>
            <button className={`vc-attach-btn ${showAttach ? "active" : ""}`}
              onClick={e => { e.stopPropagation(); setShowAttach(v => !v); }}>
              <span className="vc-attach-plus" style={{ transform: showAttach ? "rotate(45deg)" : "none" }}>＋</span>
            </button>
            <input ref={inputRef} className="vc-chat-input" value={input}
              placeholder="Message…"
              onChange={e => { setInput(e.target.value); handleTyping(); }}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendText()} />
            <button className={`vc-send-btn ${input.trim() ? "active" : ""}`} onClick={sendText} disabled={!input.trim()}>
              <span className="vc-send-icon">▶</span>
            </button>
          </div>
          <div className="vc-enc-bar">🔒 AES-256-GCM · All messages &amp; files encrypted end-to-end · Max 4 MB</div>
        </div>
      )}
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --primary: #7C6FFF;
  --primary-dark: #6558F5;
  --primary-glow: rgba(124,111,255,0.35);
  --surface: #ffffff;
  --surface-2: #F8F7FF;
  --surface-3: #F0EEFF;
  --border: #EAE8FF;
  --text: #1A1730;
  --text-2: #6B6890;
  --text-3: #B0ACCE;
  --accent-pink: #FF6B9D;
  --accent-teal: #00D4AA;
  --radius-lg: 28px;
  --radius-md: 18px;
  --radius-sm: 12px;
  --shadow-sm: 0 2px 12px rgba(124,111,255,.08);
  --shadow-md: 0 8px 32px rgba(124,111,255,.14);
  --shadow-lg: 0 20px 60px rgba(124,111,255,.2);
  --font: 'Plus Jakarta Sans', sans-serif;
}

.vc-app {
  font-family: var(--font);
  min-height: 100vh;
  background: #F0EEFF;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

/* ── Background orbs ── */
.vc-bg-orbs {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}
.vc-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.45;
  animation: vcFloat 8s ease-in-out infinite;
}
.vc-orb1 {
  width: 380px; height: 380px;
  background: radial-gradient(circle, #C4BCFF, #A89BFF);
  top: -100px; left: -100px;
  animation-duration: 9s;
}
.vc-orb2 {
  width: 300px; height: 300px;
  background: radial-gradient(circle, #FFB3CC, #FF6B9D80);
  bottom: -80px; right: -80px;
  animation-duration: 11s; animation-delay: -3s;
}
.vc-orb3 {
  width: 220px; height: 220px;
  background: radial-gradient(circle, #B3F0E0, #00D4AA60);
  top: 40%; left: 60%;
  animation-duration: 13s; animation-delay: -6s;
}
@keyframes vcFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  33% { transform: translateY(-20px) scale(1.04); }
  66% { transform: translateY(12px) scale(0.97); }
}

/* ── Page & Card ── */
.vc-page {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
  z-index: 1;
}
.vc-card {
  width: 100%;
  max-width: 400px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: var(--radius-lg);
  padding: 32px 28px 30px;
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(124,111,255,.1);
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: relative;
  overflow: hidden;
}
.vc-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--primary), var(--accent-pink), var(--accent-teal));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

/* ── Home ── */
.vc-home-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.vc-greet {
  font-size: 12px;
  color: var(--text-3);
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.vc-brand {
  font-size: 30px;
  font-weight: 900;
  color: var(--text);
  letter-spacing: -.03em;
  line-height: 1.1;
}
.vc-brand-dot {
  color: var(--primary);
}
.vc-lock-badge {
  width: 52px; height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px var(--primary-glow);
  animation: vcPulse 3s ease-in-out infinite;
}
.vc-lock-icon { font-size: 22px; }
@keyframes vcPulse {
  0%, 100% { box-shadow: 0 8px 24px var(--primary-glow); }
  50% { box-shadow: 0 8px 36px rgba(124,111,255,.55); }
}

/* ── Primary Button ── */
.vc-primary-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  border: none;
  border-radius: 20px;
  padding: 16px 18px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease;
  box-shadow: 0 8px 28px var(--primary-glow);
  position: relative;
  overflow: hidden;
}
.vc-primary-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.15) 0%, transparent 60%);
  pointer-events: none;
}
.vc-primary-btn:hover:not(.disabled) {
  transform: translateY(-3px) scale(1.01);
  box-shadow: 0 14px 40px var(--primary-glow);
}
.vc-primary-btn:active:not(.disabled) {
  transform: translateY(0) scale(0.99);
}
.vc-primary-btn.disabled { opacity: .45; pointer-events: none; }

.vc-btn-icon-wrap {
  flex-shrink: 0;
}
.vc-btn-icon {
  font-size: 20px;
  color: #fff;
  background: rgba(255,255,255,.2);
  width: 42px; height: 42px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .2s;
}
.vc-btn-text { flex: 1; }
.vc-btn-title { color: #fff; font-weight: 800; font-size: 15px; }
.vc-btn-sub { color: rgba(255,255,255,.6); font-size: 12px; margin-top: 2px; }
.vc-btn-arrow { color: rgba(255,255,255,.7); font-size: 18px; font-weight: 700; }

/* ── Or divider ── */
.vc-or { display: flex; align-items: center; gap: 12px; }
.vc-or-line { flex: 1; height: 1px; background: var(--border); }
.vc-or-text { font-size: 12px; color: var(--text-3); white-space: nowrap; font-weight: 600; }

/* ── Join row ── */
.vc-join-row { display: flex; gap: 8px; }
.vc-code-input {
  flex: 1;
  background: var(--surface-2);
  border: 2px solid var(--border);
  border-radius: 16px;
  padding: 14px 18px;
  font-family: var(--font);
  font-size: 18px;
  font-weight: 900;
  letter-spacing: .25em;
  text-transform: uppercase;
  color: var(--text);
  outline: none;
  transition: border-color .2s, box-shadow .2s;
}
.vc-code-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(124,111,255,.1);
}
.vc-join-btn {
  width: 52px; height: 52px;
  background: var(--surface-3);
  border: 2px solid var(--border);
  color: var(--text-3);
  border-radius: 16px;
  font-size: 20px;
  cursor: pointer;
  transition: all .25s cubic-bezier(.34,1.56,.64,1);
  display: flex; align-items: center; justify-content: center;
}
.vc-join-btn.active {
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  border-color: transparent;
  color: #fff;
  box-shadow: 0 6px 20px var(--primary-glow);
  transform: scale(1.05);
}
.vc-join-arrow { font-weight: 800; transition: transform .2s; }
.vc-join-btn.active:hover .vc-join-arrow { transform: translateX(2px); }

/* ── Feature chips ── */
.vc-feature-chips { display: flex; gap: 6px; }
.vc-chip {
  flex: 1;
  border-radius: 14px;
  padding: 10px 4px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  transition: transform .2s cubic-bezier(.34,1.56,.64,1);
  cursor: default;
}
.vc-chip:hover { transform: translateY(-2px); }
.vc-chip-icon { font-size: 18px; }
.vc-chip-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }

/* ── Setup screen ── */
.vc-back {
  background: none;
  border: none;
  color: var(--text-3);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color .2s;
  align-self: flex-start;
}
.vc-back:hover { color: var(--primary); }
.vc-back-arrow { font-size: 16px; transition: transform .2s; }
.vc-back:hover .vc-back-arrow { transform: translateX(-2px); }

.vc-setup-header { display: flex; flex-direction: column; gap: 6px; }
.vc-setup-title { font-size: 24px; font-weight: 900; color: var(--text); letter-spacing: -.02em; }
.vc-setup-sub { font-size: 13px; color: var(--text-3); font-weight: 500; }

/* ── Code display ── */
.vc-code-display {
  background: linear-gradient(135deg, #EDE9FF 0%, #F5F3FF 100%);
  border: 2px solid var(--border);
  border-radius: 22px;
  padding: 24px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
}
.vc-code-glow {
  position: absolute;
  width: 200px; height: 200px;
  background: radial-gradient(circle, rgba(124,111,255,.2), transparent 70%);
  top: -60px; left: -40px;
  pointer-events: none;
}
.vc-code-letters { display: flex; gap: 6px; }
.vc-code-char {
  font-size: 26px;
  font-weight: 900;
  color: var(--primary);
  letter-spacing: .02em;
  animation: vcCharPop .4s cubic-bezier(.34,1.56,.64,1) both;
  display: inline-block;
}
@keyframes vcCharPop {
  from { opacity: 0; transform: translateY(8px) scale(0.8); }
  to { opacity: 1; transform: none; }
}
.vc-copy-btn {
  background: var(--primary);
  border: none;
  color: #fff;
  border-radius: 14px;
  padding: 10px 18px;
  font-family: var(--font);
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all .2s cubic-bezier(.34,1.56,.64,1);
  box-shadow: 0 4px 14px var(--primary-glow);
  white-space: nowrap;
}
.vc-copy-btn:hover { background: var(--primary-dark); transform: scale(1.04); }

.vc-code-hint {
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 14px;
  line-height: 1.7;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.vc-hint-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }

/* ── Name input ── */
.vc-name-sec { display: flex; flex-direction: column; gap: 8px; }
.vc-name-label {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .08em;
}
.vc-name-input {
  background: var(--surface-2);
  border: 2px solid var(--border);
  border-radius: 16px;
  padding: 14px 18px;
  font-family: var(--font);
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  outline: none;
  transition: border-color .2s, box-shadow .2s;
}
.vc-name-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(124,111,255,.1);
}
.vc-err {
  color: #FF6B6B;
  font-size: 12px;
  text-align: center;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  animation: vcShake .3s ease;
}
@keyframes vcShake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

/* ── Chat root ── */
.vc-chat-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  position: relative;
  overflow: hidden;
}

/* ── Chat header ── */
.vc-chat-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 12px;
  background: rgba(255,255,255,.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  box-shadow: 0 2px 20px rgba(124,111,255,.06);
  z-index: 10;
  position: relative;
}
.vc-hdr-back {
  background: var(--surface-3);
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--primary);
  font-weight: 900;
  width: 38px; height: 38px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  transition: all .2s cubic-bezier(.34,1.56,.64,1);
  flex-shrink: 0;
}
.vc-hdr-back:hover { background: var(--primary); color: #fff; transform: scale(1.08); }
.vc-hdr-avatar {
  width: 42px; height: 42px;
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  font-weight: 900;
  font-size: 13px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}
.vc-hdr-info { flex: 1; min-width: 0; }
.vc-hdr-name {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}
.vc-hdr-room { color: var(--text-3); font-weight: 600; }
.vc-hdr-code { color: var(--primary); }
.vc-hdr-status {
  font-size: 12px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-weight: 600;
}
.vc-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.vc-dot.green { background: #2ECC71; }
.vc-dot.green.pulse { animation: vcDotPulse 2s ease-in-out infinite; }
.vc-dot.gray { background: #DDD; }
@keyframes vcDotPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(46,204,113,.4); }
  50% { box-shadow: 0 0 0 5px rgba(46,204,113,0); }
}
.vc-share-btn {
  background: var(--surface-3);
  border: 1.5px solid var(--border);
  color: var(--primary);
  border-radius: 20px;
  padding: 8px 14px;
  font-family: var(--font);
  font-weight: 800;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .2s cubic-bezier(.34,1.56,.64,1);
}
.vc-share-btn:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  transform: scale(1.04);
}

/* ── Toast ── */
.vc-toast {
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  padding: 10px 16px;
  flex-shrink: 0;
}
.vc-toast-in { animation: vcToastIn .3s cubic-bezier(.34,1.56,.64,1); }
@keyframes vcToastIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: none; }
}

/* ── Messages area ── */
.vc-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px 0 6px;
  background: linear-gradient(180deg, #FAFAFE 0%, #F5F3FF 100%);
  display: flex;
  flex-direction: column;
}

/* ── Empty state ── */
.vc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  margin: auto;
  gap: 14px;
}
.vc-empty-icon-wrap {
  position: relative;
  width: 80px; height: 80px;
  display: flex; align-items: center; justify-content: center;
}
.vc-empty-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(124,111,255,.2);
  animation: vcRingPulse 2.5s ease-in-out infinite;
}
@keyframes vcRingPulse {
  0%, 100% { transform: scale(1); opacity: .6; }
  50% { transform: scale(1.15); opacity: .2; }
}
.vc-empty-icon { font-size: 46px; }
.vc-empty-title { font-size: 20px; font-weight: 900; color: var(--text); }
.vc-empty-sub { font-size: 14px; color: var(--text-3); line-height: 1.8; max-width: 260px; }

/* ── Day divider ── */
.vc-day-div {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
}
.vc-day-line { flex: 1; height: 1px; background: var(--border); }
.vc-day-badge {
  font-size: 11px;
  color: var(--text-3);
  background: var(--surface-3);
  border: 1px solid var(--border);
  padding: 4px 12px;
  border-radius: 20px;
  font-weight: 700;
}

/* ── Messages ── */
.vc-msg-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 2px 16px;
  margin-bottom: 3px;
}
.vc-msg-row.mine { flex-direction: row-reverse; }
.vc-msg-in { animation: vcMsgIn .28s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes vcMsgIn {
  from { opacity: 0; transform: translateY(10px) scale(0.95); }
  to { opacity: 1; transform: none; }
}
.vc-msg-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  font-weight: 800;
  font-size: 11px;
  flex-shrink: 0;
  margin-bottom: 18px;
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
}
.vc-msg-col { display: flex; flex-direction: column; max-width: 75%; }
.vc-msg-sender {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 700;
  margin-bottom: 4px;
  padding-left: 4px;
}
.vc-bubble {
  padding: 11px 16px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  font-weight: 500;
  transition: transform .15s;
}
.vc-bubble:hover { transform: scale(1.01); }
.vc-bubble.mine {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  color: #fff;
  border-radius: 20px 20px 5px 20px;
  box-shadow: 0 6px 20px var(--primary-glow);
}
.vc-bubble.theirs {
  background: #fff;
  color: var(--text);
  border-radius: 20px 20px 20px 5px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
  border: 1px solid var(--border);
}
.vc-bubble.media { padding: 6px; overflow: hidden; max-width: 260px; }
.vc-bubble.media.mine { background: linear-gradient(135deg, #6E60F0, var(--primary-dark)); }
.vc-bubble.media.theirs { background: #fff; }
.vc-msg-time {
  font-size: 10px;
  color: var(--text-3);
  margin-top: 5px;
  font-weight: 600;
}
.vc-msg-time.right { text-align: right; padding-right: 4px; }
.vc-msg-time.left { text-align: left; padding-left: 4px; }

/* ── File cards ── */
.vc-file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 16px;
  min-width: 200px;
  max-width: 250px;
  transition: transform .2s;
}
.vc-file-card:hover { transform: scale(1.02); }
.vc-file-card.mine { background: rgba(255,255,255,.18); }
.vc-file-card.theirs { background: var(--surface-2); border: 1px solid var(--border); }
.vc-file-icon-box {
  width: 48px; height: 52px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex-shrink: 0;
}
.vc-file-ext { font-size: 9px; font-weight: 900; letter-spacing: .04em; }
.vc-file-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vc-file-name-text { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-file-card.mine .vc-file-name-text { color: #fff; }
.vc-file-card.theirs .vc-file-name-text { color: var(--text); }
.vc-file-size { font-size: 11px; font-weight: 600; }
.vc-file-card.mine .vc-file-size { color: rgba(255,255,255,.65); }
.vc-file-card.theirs .vc-file-size { color: var(--text-3); }
.vc-dl-hint { font-size: 10px; font-weight: 700; }
.vc-file-card.mine .vc-dl-hint { color: rgba(255,255,255,.6); }
.vc-file-card.theirs .vc-dl-hint { color: var(--primary); }
.vc-dl-arrow { font-size: 16px; flex-shrink: 0; }
.vc-file-card.mine .vc-dl-arrow { color: rgba(255,255,255,.7); }
.vc-file-card.theirs .vc-dl-arrow { color: var(--primary); }

/* ── Media ── */
.vc-media-img {
  width: 100%;
  max-width: 240px;
  border-radius: 16px;
  display: block;
  cursor: zoom-in;
  transition: all .25s cubic-bezier(.34,1.56,.64,1);
}
.vc-media-img:hover { transform: scale(1.03); }
.vc-media-video {
  width: 100%;
  max-width: 240px;
  border-radius: 16px;
  display: block;
}

/* ── Spinners ── */
.vc-spinner-sm {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: vcSpin .6s linear infinite;
  flex-shrink: 0;
}
.vc-spinner-inline {
  width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: vcSpin .6s linear infinite;
}
@keyframes vcSpin { to { transform: rotate(360deg); } }
.vc-upload-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

/* ── Typing indicator ── */
.vc-typing { display: flex; gap: 4px; align-items: center; height: 16px; }
.vc-typing span {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--text-3);
  animation: vcBounce 1.2s infinite ease-in-out;
}
.vc-typing span:nth-child(2) { animation-delay: .16s; }
.vc-typing span:nth-child(3) { animation-delay: .32s; }
@keyframes vcBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: .4; }
  30% { transform: translateY(-5px); opacity: 1; }
}

/* ── Lightbox ── */
.vc-lightbox {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 30, .95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: vcFadeIn .2s ease;
}
.vc-lightbox-img {
  max-width: 95vw;
  max-height: 85vh;
  border-radius: 16px;
  object-fit: contain;
  box-shadow: 0 30px 80px rgba(0,0,0,.7);
  animation: vcLbIn .3s cubic-bezier(.34,1.56,.64,1);
}
@keyframes vcLbIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: none; }
}
.vc-lb-actions {
  position: absolute;
  top: 20px; right: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.vc-lb-dl {
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.25);
  color: #fff;
  padding: 9px 18px;
  border-radius: 20px;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s;
}
.vc-lb-dl:hover { background: rgba(255,255,255,.22); }
.vc-lightbox-close {
  width: 38px; height: 38px;
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  transition: all .2s;
}
.vc-lightbox-close:hover { background: rgba(255,255,255,.25); transform: scale(1.1); }

/* ── Attach button & drawer ── */
.vc-attach-btn {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: var(--surface-3);
  border: 1.5px solid var(--border);
  color: var(--primary);
  font-size: 22px;
  font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all .25s cubic-bezier(.34,1.56,.64,1);
}
.vc-attach-btn:hover { background: var(--surface-2); transform: scale(1.08); }
.vc-attach-btn.active { background: var(--primary); color: #fff; box-shadow: 0 4px 14px var(--primary-glow); }
.vc-attach-plus { display: block; transition: transform .3s cubic-bezier(.34,1.56,.64,1); font-size: 20px; }

.vc-attach-drawer {
  position: absolute;
  bottom: 74px; left: 0; right: 0;
  background: rgba(255,255,255,.97);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
  padding: 12px 16px 14px;
  z-index: 20;
  box-shadow: 0 -10px 40px rgba(124,111,255,.1);
}
.vc-drawer-up { animation: vcDrawerUp .3s cubic-bezier(.34,1.56,.64,1); }
@keyframes vcDrawerUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: none; }
}
.vc-attach-handle {
  width: 36px; height: 4px;
  background: var(--border);
  border-radius: 4px;
  margin: 0 auto 12px;
}
.vc-attach-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.vc-attach-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px 4px;
  border-radius: 16px;
  font-family: var(--font);
  transition: background .15s, transform .2s cubic-bezier(.34,1.56,.64,1);
  animation: vcAttachItemIn .25s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes vcAttachItemIn {
  from { opacity: 0; transform: scale(0.85) translateY(8px); }
  to { opacity: 1; transform: none; }
}
.vc-attach-item:hover { background: var(--surface-2); transform: scale(1.06); }
.vc-attach-icon-box {
  width: 54px; height: 54px;
  border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px;
  transition: transform .2s cubic-bezier(.34,1.56,.64,1);
}
.vc-attach-item:hover .vc-attach-icon-box { transform: scale(1.08); }
.vc-attach-label { font-size: 11px; font-weight: 700; color: var(--text-2); }

/* ── Preview overlay ── */
.vc-preview-overlay {
  position: absolute;
  inset: 0;
  background: rgba(240,238,255,.97);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 30;
}
.vc-preview-sheet {
  width: 100%;
  background: #fff;
  border-radius: 28px 28px 0 0;
  padding: 12px 24px 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-shadow: 0 -8px 48px rgba(124,111,255,.15);
}
.vc-sheet-up { animation: vcSheetUp .35s cubic-bezier(.34,1.56,.64,1); }
@keyframes vcSheetUp {
  from { transform: translateY(60px); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.vc-preview-handle { width: 44px; height: 5px; background: var(--border); border-radius: 4px; margin-bottom: 4px; }
.vc-preview-title { font-size: 18px; font-weight: 900; color: var(--text); }
.vc-preview-img-wrap { border-radius: 20px; overflow: hidden; max-width: 100%; box-shadow: var(--shadow-md); }
.vc-preview-img { width: 100%; max-height: 250px; object-fit: contain; display: block; }
.vc-preview-file-icon {
  width: 110px; height: 110px;
  border-radius: 24px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
}
.vc-preview-ext { font-size: 13px; font-weight: 900; letter-spacing: .06em; }
.vc-preview-meta { text-align: center; }
.vc-preview-fname { font-size: 15px; font-weight: 800; color: var(--text); word-break: break-all; }
.vc-preview-fsize { font-size: 12px; color: var(--text-3); margin-top: 4px; font-weight: 600; }
.vc-preview-actions { display: flex; gap: 10px; width: 100%; }
.vc-preview-cancel {
  flex: 1;
  padding: 14px;
  background: var(--surface-2);
  border: 1.5px solid var(--border);
  border-radius: 18px;
  font-family: var(--font);
  font-size: 14px;
  font-weight: 800;
  color: var(--text-2);
  cursor: pointer;
  transition: all .2s;
}
.vc-preview-cancel:hover { background: var(--surface-3); }
.vc-preview-send {
  flex: 2;
  padding: 14px;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  border: none;
  border-radius: 18px;
  font-family: var(--font);
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 6px 20px var(--primary-glow);
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all .2s cubic-bezier(.34,1.56,.64,1);
}
.vc-preview-send:hover:not(:disabled) { transform: scale(1.02); box-shadow: 0 8px 28px var(--primary-glow); }
.vc-preview-send:disabled { opacity: .55; pointer-events: none; }

/* ── Input bar ── */
.vc-input-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(255,255,255,.95);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}
.vc-chat-input {
  flex: 1;
  background: var(--surface-2);
  border: 2px solid var(--border);
  border-radius: 26px;
  padding: 12px 20px;
  font-family: var(--font);
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  outline: none;
  transition: border-color .2s, box-shadow .2s;
}
.vc-chat-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(124,111,255,.1);
}
.vc-send-btn {
  width: 46px; height: 46px;
  border-radius: 50%;
  background: var(--surface-3);
  border: 1.5px solid var(--border);
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: all .25s cubic-bezier(.34,1.56,.64,1);
}
.vc-send-btn.active {
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  border-color: transparent;
  color: #fff;
  box-shadow: 0 6px 20px var(--primary-glow);
}
.vc-send-btn.active:hover { transform: scale(1.1); }
.vc-send-btn.active:active { transform: scale(0.95); }
.vc-send-icon { display: block; transition: transform .2s; }
.vc-send-btn.active:hover .vc-send-icon { transform: translateX(2px); }

/* ── Enc bar ── */
.vc-enc-bar {
  background: var(--surface-2);
  text-align: center;
  font-size: 10px;
  color: var(--text-3);
  padding: 5px 16px 7px;
  font-weight: 700;
  letter-spacing: .03em;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

/* ── Animations ── */
.vc-slide-up { animation: vcSlideUp .4s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes vcSlideUp {
  from { opacity: 0; transform: translateY(24px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
.vc-fade { animation: vcFadeIn .25s ease both; }
@keyframes vcFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(124,111,255,.2); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(124,111,255,.4); }

input::placeholder { color: var(--text-3) !important; }
`;