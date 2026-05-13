# Site Monitoring 
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Automated uptime, SSL, and SMTP monitoring for WordPress sites. 
Alerts are sent to Slack via GitHub Actions, triggered 4 times daily by cron-job.org.

---

## How It Works

1. **cron-job.org** triggers the GitHub Actions workflow every 5 minutes
2. **GitHub Actions** runs `monitor.js` which checks all sites in `sites.json`
3. **Slack** receives alerts via Incoming Webhooks

---

## Slack Setup

### Channels
Three private channels are required:
- `sites-status-dev` — uptime alerts (down/slow)
- `sites-ssl-dev` — SSL certificate expiry alerts
- `sites-smtp-dev` — SMTP server alerts

### Incoming Webhooks
Each channel requires its own Incoming Webhook:

1. Go to your Slack workspace → **Apps** → search **Incoming Webhooks**
2. Click **Add to Slack**
3. Select the channel and click **Authorize**
4. Customize the name (e.g. `Site Monitor - Status`)
5. Copy the Webhook URL
6. Repeat for each channel

---

## GitHub Setup

### Repository Structure
```
site-monitoring/
├── .github/
│   └── workflows/
│       └── monitor.yml
├── monitor.js
├── sites.json
└── README.md
```

### GitHub Secrets
Add three secrets in **Settings → Secrets and variables → Actions**:

| Secret Name | Description |
|---|---|
| `SLACK_WEBHOOK_STATUS` | Webhook URL for sites-status-dev |
| `SLACK_WEBHOOK_SSL` | Webhook URL for sites-ssl-dev |
| `SLACK_WEBHOOK_SMTP` | Webhook URL for sites-smtp-dev |

### Personal Access Token
A GitHub Personal Access Token is required for cron-job.org to trigger the workflow:

1. Go to **GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Generate a new token with `repo` and `workflow` scopes
3. Copy the token — it's only shown once
4. Add it to cron-job.org (see below)

---

## cron-job.org Setup

1. Sign up at **cron-job.org**
2. Click **Create cronjob**
3. Set the following:

| Field | Value |
|---|---|
| Title | bettameta Sites Status |
| URL | `https://api.github.com/repos/bettameta/site-monitoring/dispatches` |
| Schedule | 4 times daily |
| Request method | POST |
| Request body | `{"event_type":"monitor"}` |

4. Under **Advanced → Headers** add:

| Key | Value |
|---|---|
| `Authorization` | `token YOUR_GITHUB_TOKEN` | Current token expires 3.24.29
| `Accept` | `application/vnd.github.v3+json` |
| `Content-Type` | `application/json` |

| `Request method` | `POST` | Located in dropdown menu of Advanced

5. Save and test with **Test Run** — should return `204 No Content`

---

## sites.json

Add sites to monitor in this format:
```json > using this format if we want to add site specifit items eg. "SMTP"
{
  "smtp": "smtp.elasticemail.com",
  "sites": [
    { "url": "https://site1.com" },
    { "url": "https://site2.com" }
  ]
}
```

---

## Alert Thresholds

| Response Time | Alert |
|---|---|
| Under 2.5 seconds | No alert ✅ |
| 2.5-5 seconds | 🐢 Slow but loading |
| 5-10 seconds | ⚠️ Slow, underperforming |
| Over 10 seconds | 🚨 SITE ALERT (pings @channel) |
| No response | 🚨 SITE ALERT (pings @channel) |
| SSL expires < 7 days | ⚠️ SSL expiry warning |
| SSL expired | 🚨 SSL expired |
| SMTP unreachable | 🚨 SMTP down |

---

## PageSpeed API Setup

Slow alerts include Google PageSpeed data (Score, LCP, FCP) for deeper insight.

1. Go to **console.cloud.google.com**
2. Navigate to **APIs & Services → Library**
3. Search and enable **PageSpeed Insights API**
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → API Key**
6. Name it `PageSpeed Monitor` and restrict it to **PageSpeed Insights API**
7. Copy the key and add it as a GitHub Secret: `PAGESPEED_API_KEY`
8. Add to `monitor.yml` env section:

| Secret Name | Description |
|---|---|
| `PAGESPEED_API_KEY` | Google PageSpeed Insights API key |

### What PageSpeed data is included in alerts:
| Metric | Description |
|---|---|
| **Google Score** | Overall performance score 0-100 |
| **LCP** | Largest Contentful Paint — main content load time |
| **FCP** | First Contentful Paint — first visible content |

---

## Notifications

- **SITE ALERT** triggers `<!channel>` and sound notifications
- **SLOW alerts** include Google PageSpeed Score, LCP, and FCP data
- **SSL and SMTP** alerts go to separate channels
- **Monitor Complete** summary sent after every run

---

## Notes

- GitHub Actions free tier is used — no cost
- cron-job.org free tier is used — no cost
- cron Token expires **2027-03-24** — regenerate before then
- SMTP check uses port 25 — may need updating if provider changes
- PageSpeed Insights API is free up to 25,000 requests per day — well within limits for this use case
- PageSpeed API is used to verify and supplement server response time alerts with real user experience data (Google Score, LCP, FCP)
- Server response time sits between TTFB and FCP in the performance chain — catches server issues before they become user experience problems
- Google considers LCP over 2.5s as "needs improvement" and over 4s as "poor" — thresholds are aligned accordingly
- Reduced noise in channel by reporting site monitoring only 4 times a day. 8am - 12pm - 5pm - 9pm MT
- Site Monitoring/Status reports are generated EOM 
  
