import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy
const PORT = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Fallback chain. Override the Gemini names with GEMINI_MODELS="a,b" (no redeploy of code needed).
const geminiModels = (process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-2.5-flash-lite")
  .split(",").map(s => s.trim()).filter(Boolean);
const MODEL_CHAIN = [
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  ...geminiModels.map(model => ({ provider: "gemini", model }))
];

const ALLOWED_ORIGINS = [
  "https://shashwat0213.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  ...(process.env.EXTRA_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
];

const LIMITS = { message: 2000, historyItems: 20, historyText: 4000, timeoutMs: 20000 };
const SYSTEM_PROMPT =
  "You are JARVIS, a highly intelligent personal AI assistant created by Shashwat. " +
  "Speak with a polite, confident British tone and address the user as 'Sir'. " +
  "Reply in the language the user writes in (English, Hindi, or Hinglish). " +
  "Keep answers concise and clear unless asked for detail. Light markdown is fine.";

// ---------- middleware ----------
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOWED_ORIGINS.includes(origin)) ? cb(null, true) : cb(new Error("CORS")),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"]
}));
app.use(express.json({ limit: "20kb" }));

// Simple in-memory rate limit: 20 requests / minute / IP
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const rec = hits.get(req.ip);
  if (!rec || now > rec.reset) { hits.set(req.ip, { count: 1, reset: now + 60000 }); return next(); }
  if (++rec.count > 20) {
    res.set("Retry-After", Math.ceil((rec.reset - now) / 1000));
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  next();
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n > v.reset) hits.delete(k); }, 60000).unref();

// ---------- helpers ----------
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const h of history.slice(-LIMITS.historyItems)) {
    if (!h || typeof h.text !== "string" || !h.text.trim()) continue;
    const role = h.sender === "user" ? "user" : "assistant";
    const content = h.text.slice(0, LIMITS.historyText);
    if (out.length && out[out.length - 1].role === role) out[out.length - 1] = { role, content }; // keep roles alternating
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift(); // must start with a user turn
  if (out.length && out[out.length - 1].role === "user") out.pop(); // next turn is the new user message
  return out;
}

async function callGroq(model, message, history) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(LIMITS.timeoutMs),
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history, { role: "user", content: message }],
      temperature: 0.7, max_tokens: 1024
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Groq error ${res.status}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned an empty reply");
  return text;
}

async function callGemini(model, message, history) {
  const contents = history.map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY }, // key in header, not URL
    signal: AbortSignal.timeout(LIMITS.timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || "unknown"})`);
  return text;
}

async function getJarvisReply(message, history) {
  const errors = [];
  for (const { provider, model } of MODEL_CHAIN) {
    try {
      if (provider === "groq") {
        if (!GROQ_API_KEY) throw new Error("key missing");
        return { reply: await callGroq(model, message, history), provider, model };
      }
      if (!GEMINI_API_KEY) throw new Error("key missing");
      return { reply: await callGemini(model, message, history), provider, model };
    } catch (err) {
      console.warn(`Failed ${model}: ${err.message}`);
      errors.push(`${model}: ${err.message}`);
    }
  }
  const e = new Error("All AI models failed");
  e.details = errors;
  throw e;
}

// ---------- routes ----------
app.get("/", (req, res) => res.json({
  status: "online",
  providers: { groq: !!GROQ_API_KEY, gemini: !!GEMINI_API_KEY },
  chain: MODEL_CHAIN.map(m => m.model)
}));

app.post("/api/chat", rateLimit, async (req, res) => {
  const { message, history } = req.body || {};
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Message is required." });
  if (message.length > LIMITS.message) return res.status(413).json({ error: `Message too long (max ${LIMITS.message} characters).` });
  try {
    const result = await getJarvisReply(message.trim(), cleanHistory(history));
    res.json(result);
  } catch (err) {
    console.error("Chat failed:", err.details || err.message);
    res.status(502).json({ error: "JARVIS is currently unable to respond. Please try again." });
  }
});

// CORS / body-parse errors -> clean JSON instead of an HTML stack trace
app.use((err, req, res, next) => {
  if (err.message === "CORS") return res.status(403).json({ error: "Origin not allowed." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`JARVIS server on port ${PORT} | Groq: ${GROQ_API_KEY ? "OK" : "MISSING"} | Gemini: ${GEMINI_API_KEY ? "OK" : "MISSING"}`);
  MODEL_CHAIN.forEach((m, i) => console.log(`${i + 1}. ${m.provider} -> ${m.model}`));
});
