# NABH Readiness Guide (Vercel + Supabase)

A web app for NABH 6th Edition (Hospitals) preparation:

- **Checklist** of all 639 objective elements, by chapter or by 47 departments. Each element shows the official wording, the * documentation flag, the toolkit's evidence guidance and the department checklist notes.
- **Scoring** on NABH's 1–5 scale, with an action plan field. Everyone who signs in sees the same scores, live, with the name of whoever last changed each one.
- **Readiness**: the NABH accreditation decision rules for Final, Surveillance and Re-accreditation, calculated from your scores.
- **Policies**: a library of 115 controlled documents that covers all 187 elements needing documentation. Claude drafts each one in NABH controlled-document format, your team edits it in the page and sets its status (Draft, Under review or Approved), and it exports to Word.
- **KPIs**: all 50 indicators from the standard, plus the audit sample-size table.
- **Ask the NABH guide**: a chat grounded in the standard that cites element codes and can see your current gaps.

Sign-in uses an emailed one-time link (Supabase Auth). Anyone who signs in can update scores and policies. You can restrict access to your email domains (step 2.4).

---

## 1. What you need

| Account | Used for | Cost |
|---|---|---|
| GitHub | holds the code Vercel deploys | free |
| Vercel | hosts the site and the `/api` functions | Hobby (free) is fine for a pilot; use Pro for production |
| Supabase | email login and the shared database | free tier is fine to start |
| Anthropic Console | API key for the Claude chat and policy drafting | pay per use |

## 2. Set up Supabase (about 10 minutes)

1. Go to supabase.com and create a new project. Pick the Mumbai region (ap-south-1) to keep data in India.
2. Go to **SQL Editor → New query**, paste everything in `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. *(Optional)* To limit editing to your staff, run this in the SQL Editor:
   `insert into public.allowed_domains values ('even.in');`
   Also set `ALLOWED_EMAIL_DOMAINS=even.in` in Vercel (step 3). Separate multiple domains with commas.
5. **Authentication → Providers → Email**: keep it enabled. Turning on "Confirm email" is fine.
6. **Authentication → URL Configuration** (do this after step 3, once you have the Vercel URL):
   - set **Site URL** to `https://<your-app>.vercel.app`
   - add the same URL under **Redirect URLs**
7. **Production email.** Supabase's built-in mailer sends only a few emails per hour. Before rolling out to staff, go to **Authentication → SMTP Settings** and connect your own SMTP (Google Workspace, Microsoft 365, SES, Brevo, etc.).

## 3. Deploy to Vercel (about 5 minutes)

1. Push this folder to a new GitHub repository (it can be private).
2. In Vercel, click **Add New → Project** and import the repository. Leave Framework Preset as **Other**. You don't need a build command; the output directory is set in `vercel.json`.
3. Under **Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | *(optional)* already built in for this project |
| `SUPABASE_ANON_KEY` | *(optional)* already built in for this project |
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `ANTHROPIC_MODEL` | *(optional)* model id; default `claude-sonnet-5-5` |
| `ALLOWED_EMAIL_DOMAINS` | *(optional)* e.g. `even.in` |

4. Click **Deploy**, then finish step 2.6 with the URL Vercel gives you.
5. Open the site, enter your email, click the link in the email, and you're in.

To change something later, edit `public/index.html` and push. Vercel redeploys automatically.

## 4. Notes

- **Your data.** Scores, action plans, policy drafts and document settings live in your Supabase project. Every change is written to `audit_log` with who made it and when (Supabase → Table Editor → audit_log).
- **AI usage.** The chat and the drafter call Claude through `/api/ask` with your Anthropic key. Only signed-in users can call it, and each user is limited to about 30 requests per 10 minutes. Policy drafts take 1–2 minutes each. On the Hobby plan, functions stop after 60 seconds by default; long drafts need `maxDuration` 300, which needs Vercel Pro (or Fluid compute enabled).
- **Policy drafts are starting points.** Review them against your actual practice, the NABH Guidebook's interpretations and current law before your committee approves them.
- **Sources.** The NABH Accreditation Standards for Hospitals, 6th Edition (Jan 2025); the NABH 6th Edition Self-assessment Toolkit; and the NABH 6th Edition Departmental Assessment Checklist (compiled by Dr. Polikepati Srinivas). The standard book is NABH copyright, so keep the deployed site restricted to your organisation.
