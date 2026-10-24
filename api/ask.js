// Streams a Claude answer back to signed-in users only.
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional), ALLOWED_EMAIL_DOMAINS (optional)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
export const config = { maxDuration: 300 };

const hits = new Map(); // simple per-instance rate limit: 30 requests / 10 min / user
function limited(email) {
  const now = Date.now(), w = 10 * 60 * 1000;
  const arr = (hits.get(email) || []).filter(t => now - t < w);
  arr.push(now); hits.set(email, arr);
  return arr.length > 30;
}

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json();
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
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = token ? await getUser(token) : null;
  if (!user || !user.email) return res.status(401).send("Sign in again");
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (domains.length && !domains.some(d => user.email.toLowerCase().endsWith("@" + d))) return res.status(403).send("Email domain not allowed");
  if (limited(user.email)) return res.status(429).send("Too many requests");

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const messages = cleanMessages(body.messages);
  if (!messages) return res.status(400).send("Bad request");

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
