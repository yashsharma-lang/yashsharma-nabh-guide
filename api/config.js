// Public, non-secret settings the browser needs to start Supabase auth.
// The anon key is designed to be public; row-level security in Supabase protects the data.
// Environment variables in Vercel override these defaults.
const DEFAULT_SUPABASE_URL = "https://arnzlsmsfbkfasolwdmd.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFybnpsc21zZmJrZmFzb2x3ZG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MjM1NTEsImV4cCI6MjEwODM5OTU1MX0.xerGPxXWIe2vX5pteDZldluwya4IRxxaoogX6xKMYSY";

export const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    aiEnabled: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY),
    allowedDomains: (process.env.ALLOWED_EMAIL_DOMAINS || "").split(",").map(s => s.trim()).filter(Boolean),
  });
}
