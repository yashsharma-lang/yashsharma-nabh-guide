// Streams a Claude answer back to the page. Requires the shared access code
// (checked against Supabase), and is rate-limited per IP address.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

async function codeOk(code) {
  if (!code) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_code`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ c: code }),
  });
  const txt = await r.text();
  if (!r.ok) { console.error("check_code failed", r.status, txt.slice(0, 300)); return false; }
  return txt.trim() === "true";
}
// Env: GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY. Optional: GEMINI_MODEL, ANTHROPIC_MODEL.
export const config = { maxDuration: 300 };

const hits = new Map(); // simple per-instance rate limit: 30 requests / 10 min / IP address
function limited(key) {
  const now = Date.now(), w = 10 * 60 * 1000;
  const arr = (hits.get(key) || []).filter(t => now - t < w);
  arr.push(now); hits.set(key, arr);
  return arr.length > 30;
}

function cleanMessages(msgs) {
  if (!Array.isArray(msgs) || !msgs.length) return null;
  const out = [];
  let total = 0;
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) return null;
    total += m.content.length;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content; // API needs alternating roles
    else out.push({ role: m.role, content: m.content });
  }
  if (total > 400000) return null;
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Use POST");
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (limited(ip)) return res.status(429).send("Too many requests");
  const code = String(req.headers["x-access-code"] || "").trim();
  if (!(await codeOk(code))) return res.status(401).send(code ? "Access code not accepted" : "No access code sent");
  const useGemini = !process.env.ANTHROPIC_API_KEY && !!process.env.GEMINI_API_KEY;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) return res.status(503).send("No AI key set in Vercel (GEMINI_API_KEY or ANTHROPIC_API_KEY)");

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const messages = cleanMessages(body.messages);
  if (!messages) return res.status(400).send("Bad request");

  if (useGemini) return gemini(messages, res);
  return anthropic(messages, res);
}

async function gemini(messages, res) {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS || 16000), temperature: 0.3 },
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    console.error("Gemini error", upstream.status, t.slice(0, 500));
    return res.status(upstream.status === 429 ? 429 : 502).send("The AI service returned an error (" + upstream.status + ")");
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  const reader = upstream.body.getReader(); const dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        const c = ev.candidates && ev.candidates[0];
        if (c && c.content && c.content.parts) for (const p of c.content.parts) if (p.text && !p.thought) res.write(p.text);
        if (c && c.finishReason === "MAX_TOKENS") res.write("\u0000TRUNCATED");
        if (ev.error) res.write("\u0000ERROR");
      }
    }
  } catch (e) { console.error(e); res.write("\u0000ERROR"); }
  res.end();
}

async function anthropic(messages, res) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 12000),
      stream: true,
      messages,
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    console.error("Anthropic error", upstream.status, t);
    return res.status(upstream.status === 429 ? 429 : 502).send("The AI service returned an error");
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") res.write(ev.delta.text);
        else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason === "max_tokens") res.write("\u0000TRUNCATED");
        else if (ev.type === "error") res.write("\u0000ERROR");
      }
    }
  } catch (e) {
    console.error(e);
    res.write("\u0000ERROR");
  }
  res.end();
}
