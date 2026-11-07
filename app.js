// ========================================
// CONFIG
// ========================================
const JARVIS_BACKEND = "https://jarvis-7es3.onrender.com";
const REQUEST_TIMEOUT_MS = 70000; // covers Render cold start
const MAX_HISTORY = 20;
const $ = id => document.getElementById(id);

const messages = $("messages"), input = $("userInput"), toast = $("toast");
const coreOrb = $("coreOrb"), coreCaption = $("coreCaption"), micBtn = $("micBtn");
const statusText = $("statusText"), connectionLabel = $("connectionLabel");

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

function setCore(state, caption) {
  coreOrb.className = "core" + (state ? " " + state : "");
  coreCaption.textContent = caption;
}
const idle = () => setCore("", "CORE ACTIVE");

const hour = new Date().getHours();
$("dayPeriod").textContent = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

// ========================================
// SAFE MARKDOWN (escape first, then format)
// ========================================
function renderMarkdown(src) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts = src.split(/```(?:\w*\n)?([\s\S]*?)```/g);
  return parts.map((p, i) => {
    if (i % 2) return `<pre><code>${esc(p.replace(/\n$/, ""))}</code></pre>`;
    return esc(p)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^\s*[-*] (.+)$/gm, "• $1")
      .replace(/\n/g, "<br>");
  }).join("");
}

// ========================================
// VOICE OUTPUT (mute toggle, language auto-detect)
// ========================================
let voiceEnabled = store.get("jarvis_voice", true);
let voices = [];
if ("speechSynthesis" in window) {
  const load = () => { voices = speechSynthesis.getVoices(); };
  load();
  speechSynthesis.onvoiceschanged = load;
}
function pickVoice(lang) {
  const base = lang.slice(0, 2);
  return voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(base)) || null;
}
function speak(text) {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  const clean = text.replace(/```[\s\S]*?```/g, " code block ").replace(/[*_`#>•]/g, "").trim();
  if (!clean) return;
  speechSynthesis.cancel();
  const lang = /[\u0900-\u097F]/.test(clean) ? "hi-IN" : "en-GB";
  const u = new SpeechSynthesisUtterance(clean.slice(0, 600));
  u.lang = lang; u.pitch = 0.9;
  const v = pickVoice(lang) || pickVoice("en-IN") || pickVoice("en");
  if (v) u.voice = v;
  u.onstart = () => setCore("speaking", "SPEAKING...");
  u.onend = u.onerror = idle;
  speechSynthesis.speak(u);
}
function refreshVoiceBtn() {
  $("muteBtn").textContent = voiceEnabled ? "🔊" : "🔇";
  $("muteBtn").setAttribute("aria-label", voiceEnabled ? "Mute voice replies" : "Unmute voice replies");
}
$("muteBtn").addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  store.set("jarvis_voice", voiceEnabled);
  if (!voiceEnabled) speechSynthesis.cancel(), idle();
  refreshVoiceBtn();
});
refreshVoiceBtn();

// ========================================
// CHAT UI + MEMORY (saved on this device)
// ========================================
let chatHistory = store.get("jarvis_chat", []);
let busy = false, lastText = "";
const saveChat = () => store.set("jarvis_chat", chatHistory);

function addMessage(text, who = "jarvis", opts = {}) {
  const bubble = document.createElement("div");
  bubble.className = "message" + (who === "user" ? " user" : "") + (opts.typing ? " typing" : "");
  const sender = document.createElement("span");
  sender.className = "sender";
  sender.textContent = who === "user" ? "YOU" : "J.A.R.V.I.S.";
  const body = document.createElement("div");
  body.className = "body";
  if (opts.typing) body.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  else if (who === "user") body.textContent = text;
  else body.innerHTML = renderMarkdown(text);
  bubble.append(sender, body);

  if (who !== "user" && !opts.typing && !opts.error) {
    const copy = document.createElement("button");
    copy.className = "mini"; copy.type = "button"; copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }
      catch { copy.textContent = "Failed"; }
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
    bubble.append(copy);
  }
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function restoreChat() {
  if (!Array.isArray(chatHistory)) chatHistory = [];
  chatHistory = chatHistory.filter(m => m && typeof m.text === "string").slice(-MAX_HISTORY);
  chatHistory.forEach(m => addMessage(m.text, m.sender === "user" ? "user" : "jarvis"));
}

$("clearBtn").addEventListener("click", () => {
  if (!chatHistory.length || !confirm("Clear this conversation?")) return;
  chatHistory = []; saveChat();
  messages.querySelectorAll(".message:not(.intro)").forEach(n => n.remove());
  speechSynthesis?.cancel(); idle();
});

async function sendMessage(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true; lastText = text;
  document.querySelectorAll(".message .retry").forEach(b => b.remove());

  addMessage(text, "user");
  input.value = ""; toast.textContent = "";
  const history = chatHistory.slice(-MAX_HISTORY);
  chatHistory.push({ sender: "user", text });

  setCore("thinking", "PROCESSING...");
  connectionLabel.textContent = "THINKING...";
  const waiting = addMessage("", "jarvis", { typing: true });
  const wakeTimer = setTimeout(() => {
    toast.textContent = "Server is waking up (free tier). This can take up to a minute.";
  }, 6000);

  try {
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(JARVIS_BACKEND + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(kill));

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Backend returned HTTP " + res.status);
    if (typeof data.reply !== "string" || !data.reply) throw new Error("Empty reply from server");

    waiting.remove();
    addMessage(data.reply);
    chatHistory.push({ sender: "jarvis", text: data.reply });
    chatHistory = chatHistory.slice(-MAX_HISTORY);
    saveChat();
    toast.textContent = "";
    connectionLabel.textContent = (data.model || "ONLINE").toUpperCase();
    idle();
    speak(data.reply);
  } catch (err) {
    chatHistory.pop(); // drop the unanswered user turn so history stays valid
    waiting.remove();
    const msg = err.name === "AbortError" ? "The server took too long to respond." : err.message;
    const bubble = addMessage(msg, "jarvis", { error: true });
    const retry = document.createElement("button");
    retry.className = "mini retry"; retry.type = "button"; retry.textContent = "Retry";
    retry.addEventListener("click", () => { bubble.remove(); sendMessage(lastText); });
    bubble.append(retry);
    toast.textContent = "";
    connectionLabel.textContent = "CONNECTION ISSUE";
    setCore("error", "ERROR");
    setTimeout(idle, 2000);
  } finally {
    clearTimeout(wakeTimer);
    busy = false;
  }
}

$("chatForm").addEventListener("submit", e => { e.preventDefault(); sendMessage(input.value); });

// ========================================
// VOICE INPUT (HI / EN toggle)
// ========================================
let micLang = store.get("jarvis_miclang", "hi-IN");
let listening = false;
const langBtn = $("langBtn");
langBtn.textContent = micLang === "hi-IN" ? "HI" : "EN";
langBtn.addEventListener("click", () => {
  micLang = micLang === "hi-IN" ? "en-IN" : "hi-IN";
  store.set("jarvis_miclang", micLang);
  langBtn.textContent = micLang === "hi-IN" ? "HI" : "EN";
  toast.textContent = "Voice input: " + (micLang === "hi-IN" ? "Hindi" : "English");
});

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast.textContent = "Voice input isn't supported in this browser. Try Chrome or Edge."; return; }
  if (listening) return;
  speechSynthesis?.cancel();
  const rec = new SR();
  rec.lang = micLang; rec.interimResults = false; rec.maxAlternatives = 1;
  listening = true;
  toast.textContent = "Listening... speak now.";
  setCore("listening", "LISTENING...");
  micBtn.classList.add("listening");
  rec.onresult = e => { const t = e.results[0][0].transcript; input.value = t; sendMessage(t); };
  rec.onerror = e => { toast.textContent = e.error === "not-allowed" ? "Microphone permission was denied." : "Couldn't capture voice. Try again."; };
  rec.onend = () => {
    listening = false; micBtn.classList.remove("listening");
    if (coreCaption.textContent === "LISTENING...") idle();
  };
  rec.start();
}
micBtn.addEventListener("click", startVoice);

// ========================================
// QUICK ACCESS
// ========================================
const PROMPTS = {
  projects: "Help me plan and prioritise my projects for today. Ask me what I'm working on.",
  device: "What can you help me with? Give me a short list of things I can ask you.",
  memory: "Help me organize my daily notes and important information."
};
document.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => {
  const a = btn.dataset.action;
  if (a === "voice") return startVoice();
  if (PROMPTS[a]) sendMessage(PROMPTS[a]);
}));

// ========================================
// ONLINE / OFFLINE
// ========================================
function updateOnline() {
  statusText.textContent = navigator.onLine ? "SYSTEM READY" : "OFFLINE";
  document.body.classList.toggle("offline", !navigator.onLine);
}
addEventListener("online", updateOnline);
addEventListener("offline", updateOnline);
updateOnline();

// ========================================
// PWA: service worker + install button
// ========================================
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
const installBtn = $("installBtn");
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
let deferredPrompt = null;

if (!isStandalone()) {
  if (isIOS) installBtn.hidden = false; // iOS has no install prompt; show instructions instead
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; installBtn.hidden = false; });
}
installBtn.addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; installBtn.hidden = true;
  } else if (isIOS) {
    toast.textContent = "On iPhone: tap Share, then 'Add to Home Screen'.";
  }
});
addEventListener("appinstalled", () => { installBtn.hidden = true; toast.textContent = "JARVIS installed."; });

restoreChat();
