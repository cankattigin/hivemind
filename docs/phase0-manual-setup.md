# Phase 0 — Manual Setup Checklist

## 1. Supabase SQL Migrations

Run the following in the Supabase SQL Editor (project dashboard → SQL Editor):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  type text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

## 2. Railway Environment Variables

Add these in Railway → Project → Variables:

| Variable    | Example value                  | Notes                                 |
|-------------|-------------------------------|---------------------------------------|
| `SMTP_HOST` | `smtp.gmail.com`              | Your SMTP server hostname             |
| `SMTP_PORT` | `587`                         | 587 = STARTTLS, 465 = SSL             |
| `SMTP_USER` | `yourapp@gmail.com`           | SMTP login username                   |
| `SMTP_PASS` | `your-app-password`           | Gmail: use an App Password, not your real password |
| `SMTP_FROM` | `Hivemind <yourapp@gmail.com>`| "From" header shown to recipients     |
| `APP_URL`   | `https://your-app.railway.app`| No trailing slash. Used in email links |

> If SMTP env vars are absent, emails are skipped (logged to console). The app works without them — users just won't receive emails.

## 3. Gmail App Password (if using Gmail)

1. Go to myaccount.google.com → Security → 2-Step Verification (must be on)
2. Search for "App passwords" → Create one for "Mail"
3. Use the 16-char generated password as `SMTP_PASS`

## 4. What works without email configured

- Register works (no email field required)
- Login, password change all work
- Forgot password: API returns success but no email is sent
- Email verification banner shows but "Resend" does nothing visible

## 5. Existing users

Users registered before Phase 0 have no `email` column value. They won't see the unverified banner (the banner only shows when `email` is set AND `email_verified` is false). Directors can update existing user emails if needed via direct Supabase query.
