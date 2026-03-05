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
const AC = ["#6C63FF","#FF6584","#43B89C","#F4A261","#5E60CE","#48CAE4","#E76F51","#7CB518"];
const aColor = n => { let h = 0; for (const c of (n || "")) h = (h * 31 + c.charCodeAt(0)) % AC.length; return AC[h]; };
const initials = n => (n || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtSize = b => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const MAX_BYTES = 4 * 1024 * 1024;

function getFileIcon(mime, name) {
  if (!mime && name) {
    const ext = name.split(".").pop().toLowerCase();
    if (["pdf"].includes(ext)) return { icon: "📄", color: "#E53E3E", label: "PDF" };
    if (["doc", "docx"].includes(ext)) return { icon: "📝", color: "#2B6CB0", label: "DOC" };
    if (["xls", "xlsx"].includes(ext)) return { icon: "📊", color: "#276749", label: "XLS" };
    if (["ppt", "pptx"].includes(ext)) return { icon: "📑", color: "#C05621", label: "PPT" };
    if (["zip", "rar", "7z"].includes(ext)) return { icon: "🗜", color: "#6B46C1", label: "ZIP" };
    if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return { icon: "🎵", color: "#D53F8C", label: "AUDIO" };
    if (["txt", "md", "csv"].includes(ext)) return { icon: "📃", color: "#718096", label: ext.toUpperCase() };
    return { icon: "📎", color: "#718096", label: ext.toUpperCase() };
  }
  if (mime?.startsWith("image/")) return { icon: "🖼", color: "#6C63FF", label: "IMG" };
  if (mime?.startsWith("video/")) return { icon: "🎥", color: "#FF6584", label: "VIDEO" };
  if (mime?.includes("pdf")) return { icon: "📄", color: "#E53E3E", label: "PDF" };
  if (mime?.includes("word") || mime?.includes("document")) return { icon: "📝", color: "#2B6CB0", label: "DOC" };
  if (mime?.includes("sheet") || mime?.includes("excel")) return { icon: "📊", color: "#276749", label: "XLS" };
  if (mime?.includes("presentation") || mime?.includes("powerpoint")) return { icon: "📑", color: "#C05621", label: "PPT" };
  if (mime?.includes("zip") || mime?.includes("compressed")) return { icon: "🗜", color: "#6B46C1", label: "ZIP" };
  if (mime?.startsWith("audio/")) return { icon: "🎵", color: "#D53F8C", label: "AUDIO" };
  if (mime?.startsWith("text/")) return { icon: "📃", color: "#718096", label: "TXT" };
  return { icon: "📎", color: "#718096", label: "FILE" };
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
      <div className="vc-file-icon-box" style={{ background: fileInfo.color + "18", color: fileInfo.color }}>
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

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const channelRef = useRef(null);       // Supabase realtime channel
  const typingTimer = useRef(null);      // clears typing indicator
  const cryptoKeyRef = useRef(null);     // stable ref for use inside callbacks
  cryptoKeyRef.current = cryptoKey;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  // ── Enter room: load history + set up realtime ──
  async function enterRoom(code, name) {
    setStatus("deriving");
    try {
      const key = await deriveKey(code);
      const upperCode = code.toUpperCase();

      // Load existing messages
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

      // ── Realtime channel (messages + typing + presence) ──
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
      setScreen("chat");
      setTimeout(() => inputRef.current?.focus(), 200);
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  function handleCreate() { const c = genCode(); setPendingCode(c); setSetupMode("create"); setScreen("setup"); }
  function handleJoin() { if (joinInput.trim().length < 4) return; setPendingCode(joinInput.trim().toUpperCase()); setSetupMode("join"); setScreen("setup"); }
  async function handleEnter() { if (usernameInput.trim().length < 2) return; await enterRoom(pendingCode, usernameInput.trim()); }

  // ── Send text message ──
  async function sendText() {
    if (!input.trim() || !cryptoKey || !roomCode) return;
    const text = input.trim();
    setInput("");
    const cipher = await encryptText(cryptoKey, text);
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "text", sender: username, ciphertext: cipher, ts: Date.now(),
    };
    // Optimistic update (realtime will also fire but we deduplicate)
    setMessages(prev => [...prev, { ...msg, text }]);
    try { await saveSingleMsg(roomCode, msg); } catch (e) { console.error("send failed", e); }
  }

  // ── Select file ──
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

  // ── Send file/media ──
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
      // Optimistic update
      setMessages(prev => [...prev, { ...msg }]);
      setUploadProgress("Saving…");
      await saveSingleMsg(roomCode, msg);
    } catch (e) {
      alert("Failed to send: " + e.message);
    } finally {
      setUploading(false); setUploadProgress(""); setPreview(null); setShowAttach(false);
    }
  }

  // ── Typing broadcast ──
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

  // ── Leave room ──
  function leaveRoom() {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    clearTimeout(typingTimer.current);
    setScreen("home"); setMessages([]); setRoomCode(""); setCryptoKey(null);
    setUsername(""); setInput(""); setJoinInput(""); setUsernameInput("");
    setStatus("idle"); setPreview(null); setShowAttach(false);
    setOnlineCount(1); setTyping(false);
  }

  // Group messages by day
  const grouped = [];
  let lastDay = null;
  for (const m of messages) {
    const day = new Date(m.ts).toLocaleDateString([], { month: "short", day: "numeric" });
    if (day !== lastDay) { grouped.push({ type: "day", label: day }); lastDay = day; }
    grouped.push({ type: "msg", ...m });
  }

  const ATTACH_OPTIONS = [
    { label: "Image", icon: "🖼", accept: "image/*", bg: "#F3F0FF", color: "#6C63FF" },
    { label: "Video", icon: "🎥", accept: "video/*", bg: "#FFF0F5", color: "#FF6584" },
    { label: "PDF", icon: "📄", accept: ".pdf,application/pdf", bg: "#FFF5F5", color: "#E53E3E" },
    { label: "Document", icon: "📝", accept: ".doc,.docx,.odt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document", bg: "#EBF8FF", color: "#2B6CB0" },
    { label: "Spreadsheet", icon: "📊", accept: ".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bg: "#F0FFF4", color: "#276749" },
    { label: "Audio", icon: "🎵", accept: "audio/*", bg: "#FFF0FA", color: "#D53F8C" },
    { label: "Archive", icon: "🗜", accept: ".zip,.rar,.7z,application/zip,application/x-rar-compressed", bg: "#FAF5FF", color: "#6B46C1" },
    { label: "Any File", icon: "📎", accept: "*", bg: "#F7F7FD", color: "#718096" },
  ];

  const previewFileInfo = preview?.file ? getFileIcon(preview.file.type, preview.file.name) : null;

  return (
    <div className="vc-app">
      <style>{CSS}</style>
      <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFileSelect} />

      {/* ── HOME ── */}
      {screen === "home" && (
        <div className="vc-page vc-fade">
          <div className="vc-card">
            <div className="vc-home-top">
              <div><p className="vc-greet">Hello,</p><h1 className="vc-brand">VaultChat</h1></div>
              <div className="vc-lock-badge">🔒</div>
            </div>
            <button className="vc-primary-btn" onClick={handleCreate}>
              <div className="vc-btn-icon">＋</div>
              <div><div className="vc-btn-title">New Secure Room</div><div className="vc-btn-sub">Generate encrypted room code</div></div>
            </button>
            <div className="vc-or"><div className="vc-or-line" /><span className="vc-or-text">or join existing room</span><div className="vc-or-line" /></div>
            <div className="vc-join-row">
              <input className="vc-code-input" placeholder="ROOM CODE" value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase().slice(0, 6))}
                onKeyDown={e => e.key === "Enter" && handleJoin()} maxLength={6} />
              <button className={`vc-join-btn ${joinInput.length >= 4 ? "active" : ""}`} onClick={handleJoin} disabled={joinInput.length < 4}>→</button>
            </div>
            <div className="vc-chips">
              {[["🔐", "E2EE"], ["🖼", "Images"], ["🎥", "Videos"], ["📄", "Files"]].map(([e, t]) => (
                <div key={t} className="vc-chip"><span>{e}</span><span className="vc-chip-label">{t}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SETUP ── */}
      {screen === "setup" && (
        <div className="vc-page vc-fade">
          <div className="vc-card">
            <button className="vc-back" onClick={() => setScreen("home")}>← Back</button>
            {setupMode === "create" ? (
              <>
                <h2 className="vc-setup-title">Your Room Code</h2>
                <p className="vc-setup-sub">Share this with who you want to chat with</p>
                <div className="vc-code-pill">
                  <span className="vc-code-big">{pendingCode}</span>
                  <button className="vc-copy-btn" onClick={copyCode}>{copied ? "✓ Copied!" : "Copy"}</button>
                </div>
                <div className="vc-code-hint">🔑 This code IS your encryption key. Keep it private — anyone with it can join.</div>
              </>
            ) : (
              <>
                <h2 className="vc-setup-title">Join Room</h2>
                <p className="vc-setup-sub">Connecting to encrypted room</p>
                <div className="vc-code-pill"><span className="vc-code-big">{pendingCode}</span></div>
              </>
            )}
            <div className="vc-name-sec">
              <label className="vc-name-label">Your display name</label>
              <input className="vc-name-input" placeholder="Enter your name…" value={usernameInput}
                onChange={e => setUsernameInput(e.target.value.slice(0, 20))}
                onKeyDown={e => e.key === "Enter" && handleEnter()} autoFocus />
            </div>
            <button className={`vc-primary-btn ${usernameInput.trim().length < 2 || status === "deriving" ? "disabled" : ""}`}
              onClick={handleEnter} disabled={usernameInput.trim().length < 2 || status === "deriving"}>
              <div className="vc-btn-icon">{status === "deriving" ? "⏳" : "💬"}</div>
              <div>
                <div className="vc-btn-title">{status === "deriving" ? "Connecting…" : "Enter Chat"}</div>
                <div className="vc-btn-sub">End-to-end encrypted</div>
              </div>
            </button>
            {status === "error" && <p className="vc-err">Something went wrong. Check your connection and try again.</p>}
          </div>
        </div>
      )}

      {/* ── CHAT ── */}
      {screen === "chat" && (
        <div className="vc-chat-root vc-fade" onClick={() => setShowAttach(false)}>
          {/* Header */}
          <div className="vc-chat-header">
            <button className="vc-hdr-back" onClick={leaveRoom}>←</button>
            <div className="vc-hdr-avatar" style={{ background: aColor(roomCode) }}>{roomCode.slice(0, 2)}</div>
            <div className="vc-hdr-info">
              <div className="vc-hdr-name">Room <span className="vc-hdr-code">{roomCode}</span></div>
              <div className="vc-hdr-status">
                {typing ? <><span className="vc-dot green" />typing…</>
                  : onlineCount > 1 ? <><span className="vc-dot green" />{onlineCount} online</>
                    : <><span className="vc-dot gray" />Waiting for others</>}
              </div>
            </div>
            <button className="vc-share-btn" onClick={e => { e.stopPropagation(); copyCode(); }}>{copied ? "✓ Copied" : "⎘ Share"}</button>
          </div>

          {copied && <div className="vc-toast vc-fade">Code copied! Send it to your contact.</div>}

          {/* Messages */}
          <div className="vc-messages">
            {grouped.length === 0 && (
              <div className="vc-empty">
                <div className="vc-empty-icon">🔐</div>
                <div className="vc-empty-title">Secure channel open</div>
                <div className="vc-empty-sub">Share code <strong style={{ color: "#6C63FF" }}>{roomCode}</strong> to invite someone.<br />Text, images, videos &amp; files are all encrypted.</div>
              </div>
            )}
            {grouped.map((item, i) => {
              if (item.type === "day") return (
                <div key={`d${i}`} className="vc-day-div">
                  <div className="vc-day-line" /><span className="vc-day-badge">{item.label}</span><div className="vc-day-line" />
                </div>
              );
              const mine = item.sender === username;
              return (
                <div key={item.id} className={`vc-msg-row ${mine ? "mine" : "theirs"}`}>
                  {!mine && <div className="vc-msg-avatar" style={{ background: aColor(item.sender) }}>{initials(item.sender)}</div>}
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
              <div className="vc-msg-row theirs">
                <div className="vc-bubble theirs" style={{ padding: "12px 18px" }}>
                  <div className="vc-typing"><span /><span /><span /></div>
                </div>
              </div>
            )}
            {uploading && (
              <div className="vc-msg-row mine">
                <div className="vc-bubble mine vc-upload-pill">
                  <div className="vc-spinner-sm" /><span>{uploadProgress}</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} style={{ height: "8px" }} />
          </div>

          {/* File preview overlay */}
          {preview && (
            <div className="vc-preview-overlay vc-fade" onClick={e => e.stopPropagation()}>
              <div className="vc-preview-sheet">
                <div className="vc-preview-handle" />
                <div className="vc-preview-title">Send this file?</div>
                {preview.previewSrc && preview.file.type.startsWith("image/") && (
                  <div className="vc-preview-img-wrap"><img src={preview.previewSrc} className="vc-preview-img" alt="preview" /></div>
                )}
                {preview.previewSrc && preview.file.type.startsWith("video/") && (
                  <div className="vc-preview-img-wrap"><video src={preview.previewSrc} className="vc-preview-img" controls /></div>
                )}
                {!preview.previewSrc && previewFileInfo && (
                  <div className="vc-preview-file-icon" style={{ background: previewFileInfo.color + "18" }}>
                    <span style={{ fontSize: "48px" }}>{previewFileInfo.icon}</span>
                    <div className="vc-preview-ext" style={{ color: previewFileInfo.color }}>{previewFileInfo.label}</div>
                  </div>
                )}
                <div className="vc-preview-meta">
                  <div className="vc-preview-fname">{preview.file.name}</div>
                  <div className="vc-preview-fsize">{fmtSize(preview.file.size)} · Encrypted before sending</div>
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

          {/* Attach menu */}
          {showAttach && (
            <div className="vc-attach-drawer vc-fade" onClick={e => e.stopPropagation()}>
              <div className="vc-attach-grid">
                {ATTACH_OPTIONS.map(opt => (
                  <button key={opt.label} className="vc-attach-item" onClick={() => {
                    if (fileRef.current) { fileRef.current.accept = opt.accept; fileRef.current.click(); }
                    setShowAttach(false);
                  }}>
                    <div className="vc-attach-icon-box" style={{ background: opt.bg, color: opt.color }}>{opt.icon}</div>
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
              <span style={{ display: "block", transition: "transform .25s", transform: showAttach ? "rotate(45deg)" : "none" }}>＋</span>
            </button>
            <input ref={inputRef} className="vc-chat-input" value={input}
              placeholder="Type a message…"
              onChange={e => { setInput(e.target.value); handleTyping(); }}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendText()} />
            <button className={`vc-send-btn ${input.trim() ? "active" : ""}`} onClick={sendText} disabled={!input.trim()}>▶</button>
          </div>
          <div className="vc-enc-bar">🔒 AES-256-GCM · All files encrypted · Max 4 MB per file</div>
        </div>
      )}
    </div>
  );
}

// ─── CSS (unchanged) ──────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

.vc-app{font-family:'Nunito',sans-serif;min-height:100vh;background:linear-gradient(145deg,#EEF0FF 0%,#F5F0FF 50%,#EAF4FF 100%);display:flex;align-items:center;justify-content:center}

.vc-page{width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.vc-card{width:100%;max-width:390px;background:#fff;border-radius:32px;padding:32px 26px 28px;box-shadow:0 24px 64px rgba(108,99,255,.13),0 4px 24px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:18px}

.vc-home-top{display:flex;align-items:center;justify-content:space-between}
.vc-greet{font-size:13px;color:#BBB;font-weight:600}
.vc-brand{font-size:28px;font-weight:900;color:#1A1A2E;letter-spacing:-.02em}
.vc-lock-badge{width:44px;height:44px;border-radius:50%;background:#F3F0FF;display:flex;align-items:center;justify-content:center;font-size:20px}

.vc-primary-btn{display:flex;align-items:center;gap:14px;background:#6C63FF;border:none;border-radius:20px;padding:16px 20px;cursor:pointer;width:100%;text-align:left;transition:all .2s;box-shadow:0 8px 24px rgba(108,99,255,.3)}
.vc-primary-btn:hover:not(.disabled){transform:translateY(-2px);box-shadow:0 12px 32px rgba(108,99,255,.4)}
.vc-primary-btn.disabled{opacity:.45;pointer-events:none}
.vc-btn-icon{font-size:20px;color:#fff;background:rgba(255,255,255,.2);width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.vc-btn-title{color:#fff;font-weight:800;font-size:15px}
.vc-btn-sub{color:rgba(255,255,255,.65);font-size:12px;margin-top:2px}

.vc-or{display:flex;align-items:center;gap:10px}
.vc-or-line{flex:1;height:1px;background:#F0F0F8}
.vc-or-text{font-size:12px;color:#CCC;white-space:nowrap;font-weight:600}

.vc-join-row{display:flex;gap:8px}
.vc-code-input{flex:1;background:#F7F7FD;border:2px solid #EBEBF5;border-radius:16px;padding:13px 16px;font-family:'Nunito',sans-serif;font-size:16px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#1A1A2E;outline:none;transition:border-color .2s}
.vc-code-input:focus{border-color:#6C63FF}
.vc-join-btn{background:#EBEBF5;border:none;color:#AAA;border-radius:16px;padding:0 20px;font-size:22px;cursor:pointer;transition:all .2s;opacity:.5}
.vc-join-btn.active{background:#6C63FF;color:#fff;opacity:1;box-shadow:0 4px 14px rgba(108,99,255,.3)}

.vc-chips{display:flex;gap:6px}
.vc-chip{flex:1;background:#F7F7FD;border:1px solid #EBEBF5;border-radius:14px;padding:10px 4px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:18px}
.vc-chip-label{font-size:9px;color:#AAA;font-weight:700;text-transform:uppercase;letter-spacing:.03em}

.vc-back{background:none;border:none;color:#AAA;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;cursor:pointer}
.vc-back:hover{color:#6C63FF}
.vc-setup-title{font-size:22px;font-weight:900;color:#1A1A2E}
.vc-setup-sub{font-size:13px;color:#AAA;margin-top:-10px}
.vc-code-pill{display:flex;align-items:center;justify-content:space-between;background:#F3F0FF;border:2px solid #D9D5FF;border-radius:20px;padding:18px 22px}
.vc-code-big{font-size:30px;font-weight:900;letter-spacing:.25em;color:#6C63FF}
.vc-copy-btn{background:#6C63FF;border:none;color:#fff;border-radius:12px;padding:9px 18px;font-family:'Nunito',sans-serif;font-weight:800;font-size:13px;cursor:pointer}
.vc-copy-btn:hover{background:#5A52E0}
.vc-code-hint{font-size:12px;color:#AAA;background:#FAFAFA;border:1px solid #F0F0F0;border-radius:12px;padding:12px 14px;line-height:1.7}
.vc-name-sec{display:flex;flex-direction:column;gap:8px}
.vc-name-label{font-size:12px;color:#AAA;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.vc-name-input{background:#F7F7FD;border:2px solid #EBEBF5;border-radius:16px;padding:13px 16px;font-family:'Nunito',sans-serif;font-size:15px;font-weight:700;color:#1A1A2E;outline:none;transition:border-color .2s}
.vc-name-input:focus{border-color:#6C63FF}
.vc-err{color:#FF6B6B;font-size:12px;text-align:center;font-weight:600}

.vc-chat-root{display:flex;flex-direction:column;height:100vh;width:100%;max-width:480px;background:#fff;box-shadow:0 0 80px rgba(108,99,255,.12);position:relative;overflow:hidden}
.vc-chat-header{display:flex;align-items:center;gap:12px;padding:14px 16px 12px;background:#fff;border-bottom:1px solid #F0F0F8;flex-shrink:0;box-shadow:0 2px 16px rgba(0,0,0,.04);z-index:10;position:relative}
.vc-hdr-back{background:none;border:none;font-size:22px;cursor:pointer;color:#6C63FF;font-weight:900;padding:0 4px;line-height:1}
.vc-hdr-avatar{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:13px;flex-shrink:0}
.vc-hdr-info{flex:1;min-width:0}
.vc-hdr-name{font-size:16px;font-weight:800;color:#1A1A2E}
.vc-hdr-code{color:#6C63FF}
.vc-hdr-status{font-size:12px;color:#AAA;display:flex;align-items:center;gap:5px;margin-top:2px;font-weight:600}
.vc-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.vc-dot.green{background:#2ECC71;box-shadow:0 0 6px #2ECC7160}
.vc-dot.gray{background:#DDD}
.vc-share-btn{background:#F3F0FF;border:none;color:#6C63FF;border-radius:20px;padding:8px 14px;font-family:'Nunito',sans-serif;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;transition:all .2s}
.vc-share-btn:hover{background:#6C63FF;color:#fff}
.vc-toast{background:#6C63FF;color:#fff;font-size:12px;font-weight:700;text-align:center;padding:9px 16px;flex-shrink:0}

.vc-messages{flex:1;overflow-y:auto;padding:12px 0;background:#FAFAFE;display:flex;flex-direction:column}
.vc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;margin:auto}
.vc-empty-icon{font-size:52px;margin-bottom:14px}
.vc-empty-title{font-size:20px;font-weight:900;color:#1A1A2E;margin-bottom:10px}
.vc-empty-sub{font-size:14px;color:#AAA;line-height:1.8}

.vc-day-div{display:flex;align-items:center;gap:10px;padding:12px 16px}
.vc-day-line{flex:1;height:1px;background:#EBEBF5}
.vc-day-badge{font-size:11px;color:#BBB;background:#F3F3FA;padding:3px 12px;border-radius:20px;font-weight:700}

.vc-msg-row{display:flex;align-items:flex-end;gap:8px;padding:2px 16px;margin-bottom:2px}
.vc-msg-row.mine{flex-direction:row-reverse}
.vc-msg-avatar{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:11px;flex-shrink:0;margin-bottom:18px}
.vc-msg-col{display:flex;flex-direction:column;max-width:75%}
.vc-msg-sender{font-size:11px;color:#AAA;font-weight:700;margin-bottom:4px;padding-left:4px}
.vc-bubble{padding:11px 16px;font-size:14px;line-height:1.55;word-break:break-word;font-weight:600}
.vc-bubble.mine{background:#6C63FF;color:#fff;border-radius:20px 20px 4px 20px;box-shadow:0 4px 14px rgba(108,99,255,.28)}
.vc-bubble.theirs{background:#fff;color:#1A1A2E;border-radius:20px 20px 20px 4px;box-shadow:0 2px 10px rgba(0,0,0,.07);border:1px solid #F0F0F8}
.vc-bubble.media{padding:6px;overflow:hidden;max-width:260px}
.vc-bubble.media.mine{background:#5A52EE}
.vc-bubble.media.theirs{background:#fff}
.vc-msg-time{font-size:10px;color:#CCC;margin-top:4px;font-weight:600}
.vc-msg-time.right{text-align:right;padding-right:2px}
.vc-msg-time.left{text-align:left;padding-left:4px}

.vc-file-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;min-width:200px;max-width:250px;cursor:default}
.vc-file-card.mine{background:rgba(255,255,255,.15)}
.vc-file-card.theirs{background:#F7F7FD;border:1px solid #EBEBF5}
.vc-file-icon-box{width:48px;height:52px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex-shrink:0}
.vc-file-ext{font-size:9px;font-weight:900;letter-spacing:.04em}
.vc-file-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.vc-file-name-text{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vc-file-card.mine .vc-file-name-text{color:#fff}
.vc-file-card.theirs .vc-file-name-text{color:#1A1A2E}
.vc-file-size{font-size:11px;font-weight:600}
.vc-file-card.mine .vc-file-size{color:rgba(255,255,255,.65)}
.vc-file-card.theirs .vc-file-size{color:#AAA}
.vc-dl-hint{font-size:10px;font-weight:700}
.vc-file-card.mine .vc-dl-hint{color:rgba(255,255,255,.6)}
.vc-file-card.theirs .vc-dl-hint{color:#6C63FF}
.vc-dl-arrow{font-size:18px;flex-shrink:0}
.vc-file-card.mine .vc-dl-arrow{color:rgba(255,255,255,.7)}
.vc-file-card.theirs .vc-dl-arrow{color:#6C63FF}

.vc-media-img{width:100%;max-width:240px;border-radius:14px;display:block;cursor:zoom-in;transition:opacity .2s}
.vc-media-img:hover{opacity:.92}
.vc-media-video{width:100%;max-width:240px;border-radius:14px;display:block}
.vc-media-loading{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;color:#AAA;min-width:140px}
.vc-media-err{padding:10px 14px;font-size:12px;color:#FF6B6B}

.vc-spinner{width:22px;height:22px;border:2.5px solid rgba(108,99,255,.2);border-top-color:#6C63FF;border-radius:50%;animation:vcSpin .7s linear infinite}
.vc-spinner-sm{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:vcSpin .7s linear infinite;flex-shrink:0}
@keyframes vcSpin{to{transform:rotate(360deg)}}
.vc-upload-pill{display:flex;align-items:center;gap:8px;font-size:13px;opacity:.85}

.vc-typing{display:flex;gap:4px;align-items:center;height:16px}
.vc-typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#CCC;animation:vcBounce 1.3s infinite ease-in-out}
.vc-typing span:nth-child(2){animation-delay:.18s}
.vc-typing span:nth-child(3){animation-delay:.36s}
@keyframes vcBounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}

.vc-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:1000;animation:vcFadeIn .2s ease}
.vc-lightbox-img{max-width:95vw;max-height:85vh;border-radius:12px;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.vc-lb-actions{position:absolute;top:20px;right:20px;display:flex;align-items:center;gap:10px}
.vc-lb-dl{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:8px 16px;border-radius:20px;font-family:'Nunito',sans-serif;font-size:13px;font-weight:700;cursor:pointer}
.vc-lb-dl:hover{background:rgba(255,255,255,.25)}
.vc-lightbox-close{width:36px;height:36px;background:rgba(255,255,255,.15);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;cursor:pointer}

.vc-attach-btn{width:42px;height:42px;border-radius:50%;background:#F3F0FF;border:none;color:#6C63FF;font-size:22px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s}
.vc-attach-btn:hover,.vc-attach-btn.active{background:#6C63FF;color:#fff}
.vc-attach-drawer{position:absolute;bottom:74px;left:0;right:0;background:#fff;border-top:1px solid #F0F0F8;padding:16px 16px 10px;z-index:20;box-shadow:0 -8px 30px rgba(0,0,0,.08)}
.vc-attach-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.vc-attach-item{display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer;padding:8px 4px;border-radius:14px;font-family:'Nunito',sans-serif;transition:background .15s}
.vc-attach-item:hover{background:#F7F7FD}
.vc-attach-icon-box{width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px}
.vc-attach-label{font-size:11px;font-weight:700;color:#666}

.vc-preview-overlay{position:absolute;inset:0;background:rgba(255,255,255,.97);display:flex;align-items:flex-end;justify-content:center;z-index:30;backdrop-filter:blur(4px)}
.vc-preview-sheet{width:100%;background:#fff;border-radius:28px 28px 0 0;padding:12px 24px 28px;display:flex;flex-direction:column;align-items:center;gap:16px;box-shadow:0 -8px 40px rgba(0,0,0,.1)}
.vc-preview-handle{width:40px;height:4px;background:#E0E0E0;border-radius:4px;margin-bottom:4px}
.vc-preview-title{font-size:17px;font-weight:900;color:#1A1A2E}
.vc-preview-img-wrap{border-radius:20px;overflow:hidden;max-width:100%;box-shadow:0 8px 32px rgba(0,0,0,.1)}
.vc-preview-img{width:100%;max-height:260px;object-fit:contain;display:block}
.vc-preview-file-icon{width:100px;height:110px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.vc-preview-ext{font-size:13px;font-weight:900;letter-spacing:.06em}
.vc-preview-meta{text-align:center}
.vc-preview-fname{font-size:15px;font-weight:800;color:#1A1A2E;word-break:break-all}
.vc-preview-fsize{font-size:12px;color:#AAA;margin-top:4px;font-weight:600}
.vc-preview-actions{display:flex;gap:10px;width:100%}
.vc-preview-cancel{flex:1;padding:14px;background:#F7F7FD;border:1.5px solid #EBEBF5;border-radius:16px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:800;color:#888;cursor:pointer}
.vc-preview-send{flex:2;padding:14px;background:#6C63FF;border:none;border-radius:16px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:800;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(108,99,255,.3);display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s}
.vc-preview-send:hover:not(:disabled){background:#5A52E0}
.vc-preview-send:disabled{opacity:.55;pointer-events:none}

.vc-input-bar{display:flex;align-items:center;gap:10px;padding:12px 16px 12px;background:#fff;border-top:1px solid #F0F0F8;flex-shrink:0;position:relative;z-index:10}
.vc-chat-input{flex:1;background:#F7F7FD;border:2px solid #EBEBF5;border-radius:26px;padding:12px 20px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:600;color:#1A1A2E;outline:none;transition:border-color .2s}
.vc-chat-input:focus{border-color:#6C63FF}
.vc-send-btn{width:46px;height:46px;border-radius:50%;background:#EBEBF5;border:none;color:#AAA;font-size:16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s}
.vc-send-btn.active{background:#6C63FF;color:#fff;box-shadow:0 4px 14px rgba(108,99,255,.35)}
.vc-send-btn.active:hover{transform:scale(1.08)}
.vc-enc-bar{background:#F7F7FD;text-align:center;font-size:10px;color:#CCC;padding:5px 16px 7px;font-weight:700;letter-spacing:.03em;border-top:1px solid #F0F0F0;flex-shrink:0}

::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#E0E0F0;border-radius:4px}
input::placeholder{color:#CCC !important}
.vc-fade{animation:vcFadeIn .25s ease both}
@keyframes vcFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`;