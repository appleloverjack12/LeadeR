# kajgod. Lead Intelligence

Automated lead intelligence digest for kajgod.agency. Scans business news across Croatia 🇭🇷, Slovenia 🇸🇮 and Austria 🇦🇹 every 3 days, identifies genuine opportunities for marketing and event management work, and delivers a clean email digest with direct LinkedIn search links to the right contacts.

---

## What it does

- Scans 15+ regional RSS feeds every 3 days
- Uses Claude AI to filter out noise and identify only genuine buying signals
- Flags companies that are expanding, opening new venues, launching products, hiring marketing roles, organising events
- For each opportunity: explains what it is, why kajgod. should care, and gives a one-click LinkedIn search to find the right person (CEO, Marketing Director, Event Manager)
- Sends a branded HTML email digest

---

## Setup (10 minutes, one time)

### 1 — Fork or push this repo to GitHub

### 2 — Add secrets in GitHub
Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these 4 secrets:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |
| `GMAIL_USER` | Gmail address to send FROM (e.g. hello@kajgod.agency) |
| `GMAIL_APP_PASSWORD` | Gmail App Password (see below) |
| `EMAIL_TO` | Email address to send TO (can be same as GMAIL_USER) |

### 3 — Get a Gmail App Password
Regular Gmail password won't work — you need an App Password:
1. Go to your Google Account → **Security**
2. Enable **2-Step Verification** if not already on
3. Search for **"App passwords"**
4. Create one → select **Mail** → **Other** → name it "kajgod-leads"
5. Copy the 16-character password — use this as `GMAIL_APP_PASSWORD`

### 4 — Test it manually
Go to your repo → **Actions → kajgod. Lead Intelligence → Run workflow**

It will run immediately and send the first email. Check your inbox.

### 5 — Done
From now on it runs automatically every 3 days at 9:00 CET.

---

## Customising sources

Edit `src/index.js` → the `SOURCES` array at the top. Each entry is an RSS feed URL and a region tag (HR/SI/AT).

Google News RSS format for custom searches:
```
https://news.google.com/rss/search?q=YOUR+SEARCH+TERMS&hl=hr&gl=HR&ceid=HR:hr
```

---

## Cost

- GitHub Actions: **free** (2000 minutes/month free tier, this uses ~2 min per run)
- Claude API: **~$0.50–2/month** depending on volume of news items
- Gmail: **free**

---

## Tech stack

- Node.js 20
- `rss-parser` — RSS/Atom feed parsing
- `node-fetch` — HTTP requests to Anthropic API
- `nodemailer` — Gmail email delivery
- Claude claude-sonnet-4-20250514 — opportunity scoring and analysis
- GitHub Actions — scheduling and execution
