// Public, non-secret settings the browser needs to start Supabase auth.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    allowedDomains: (process.env.ALLOWED_EMAIL_DOMAINS || "").split(",").map(s => s.trim()).filter(Boolean),
  });
}
