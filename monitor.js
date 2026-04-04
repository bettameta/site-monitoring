// --- Site Monitoring + PageSpeed API data ---
const https = require('https');
const fs = require('fs');
const tls = require('tls');
const net = require('net');
const { logAlert } = require('./logger');

// Load Config
const config = JSON.parse(fs.readFileSync('sites.json', 'utf8'));
const { sites } = config;
const smtpHost = config.smtp;

// Environment Webhooks
const statusWebhook = process.env.SLACK_WEBHOOK_STATUS;
const sslWebhook = process.env.SLACK_WEBHOOK_SSL;
const smtpWebhook = process.env.SLACK_WEBHOOK_SMTP;
const pageSpeedKey = process.env.PAGESPEED_API_KEY;

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Helper: Site Status Check ---
async function checkSite(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = https.get(url, {
      timeout: 6000,
      headers: { 'User-Agent': 'GitHub-Ops-Monitor' }
    }, (res) => {
      resolve({ status: res.statusCode, responseTime: Date.now() - startTime });
    });
    req.on('error', () => resolve({ status: null, responseTime: 99000 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, responseTime: 99000 });
    });
  });
}

// --- Helper: SSL Expiry Check ---
async function checkSSL(urlStr) {
  return new Promise((resolve) => {
    try {
      const hostname = new URL(urlStr).hostname;
      const socket = tls.connect(443, hostname, { servername: hostname, timeout: 5000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        resolve(cert && cert.valid_to ? new Date(cert.valid_to) : null);
      });
      socket.on('error', () => { if (socket) socket.destroy(); resolve(null); });
      socket.on('timeout', () => { if (socket) socket.destroy(); resolve(null); });
    } catch (e) { resolve(null); }
  });
}

// --- Helper: PageSpeed Check ---
async function checkPageSpeed(url) {
  return new Promise((resolve) => {
    if (!pageSpeedKey) return resolve(null);
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${pageSpeedKey}&strategy=mobile&category=performance`;
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const lcp = json.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue || 'N/A';
          const fcp = json.lighthouseResult?.audits?.['first-contentful-paint']?.displayValue || 'N/A';
          const score = json.lighthouseResult?.categories?.performance?.score;
          resolve({ lcp, fcp, score: score ? Math.round(score * 100) : 'N/A' });
        } catch (e) {
          console.error(`PageSpeed Error for ${url}:`, e.message);
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// --- Helper: SMTP Port Check ---
async function checkSMTP(hostname) {
  return new Promise((resolve) => {
    if (!hostname) return resolve(false);
    const socket = net.createConnection(25, hostname);
    socket.setTimeout(5000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

// --- Helper: Slack Alert ---
async function alertSlack(message, webhook) {
  if (!webhook) return;
  const payload = JSON.stringify({ text: message, link_names: 1 });
  const url = new URL(webhook);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

// --- Logic for a Single Site ---
async function checkOneSite(site) {
  const { url } = site;
  const [siteData, expireDate] = await Promise.all([checkSite(url), checkSSL(url)]);

  const alerts = [];
  let isIssue = false;

  // 1. Status Logic
  if (siteData.responseTime >= 99000) {
    isIssue = true;
    await delay(1000);
    const ps = await checkPageSpeed(url);
    const psInfo = ps ? ` | Google Score: ${ps.score}/100 | LCP: ${ps.lcp} | FCP: ${ps.fcp}` : '';
    logAlert({ url, alertType: 'SITE ALERT', responseTime: siteData.responseTime, lcp: ps?.lcp, fcp: ps?.fcp, googleScore: ps?.score });
    alerts.push(alertSlack(`<!channel> 🚨 *SITE ALERT:* ${url} appears to be down. Please verify and escalate if needed.${psInfo}`, statusWebhook));
  } else if (siteData.responseTime >= 10000) {
    isIssue = true;
    await delay(1000);
    const ps = await checkPageSpeed(url);
    const psInfo = ps ? ` | Google Score: ${ps.score}/100 | LCP: ${ps.lcp} | FCP: ${ps.fcp}` : '';
    logAlert({ url, alertType: 'CRITICAL', responseTime: siteData.responseTime, lcp: ps?.lcp, fcp: ps?.fcp, googleScore: ps?.score });
    alerts.push(alertSlack(`<!channel> 🔴 *CRITICAL:* ${url} (${(siteData.responseTime / 1000).toFixed(1)}s) — critically slow, please investigate.${psInfo}`, statusWebhook));
  } else if (siteData.responseTime > 5000) {
    await delay(1000);
    const ps = await checkPageSpeed(url);
    const psInfo = ps ? ` | Google Score: ${ps.score}/100 | LCP: ${ps.lcp} | FCP: ${ps.fcp}` : '';
    logAlert({ url, alertType: 'CAUTION', responseTime: siteData.responseTime, lcp: ps?.lcp, fcp: ps?.fcp, googleScore: ps?.score });
    alerts.push(alertSlack(`⚠️ *CAUTION:* ${url} (${(siteData.responseTime / 1000).toFixed(1)}s) — significant lag detected during load.${psInfo}`, statusWebhook));
  } else if (siteData.responseTime > 2500) {
    await delay(1000);
    const ps = await checkPageSpeed(url);
    const psInfo = ps ? ` | Google Score: ${ps.score}/100 | LCP: ${ps.lcp} | FCP: ${ps.fcp}` : '';
    logAlert({ url, alertType: 'SLUGGISH', responseTime: siteData.responseTime, lcp: ps?.lcp, fcp: ps?.fcp, googleScore: ps?.score });
    alerts.push(alertSlack(`🐢 *SLUGGISH:* ${url} (${(siteData.responseTime / 1000).toFixed(1)}s) — triggered minimum loading threshold.${psInfo}`, statusWebhook));
  }

  // 2. SSL Logic
  if (expireDate) {
    const daysLeft = Math.floor((expireDate - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 7) {
      const msg = daysLeft <= 0 ? `🚨 *SSL EXPIRED:* ${url}` : `⚠️ *SSL EXPIRING:* ${url} (${daysLeft}d)`;
      alerts.push(alertSlack(msg, sslWebhook));
    }
  }

  await Promise.all(alerts);
  return { url, isIssue };
}

// --- Main Runner ---
async function run() {
  const BATCH_SIZE = 10;
  const allResults = [];
  const start = Date.now();

  console.log(`🚀 Starting monitor for ${sites.length} sites...`);

  const smtpActive = await checkSMTP(smtpHost);
  if (!smtpActive) {
    await alertSlack(`<!channel> 🚨 *SMTP DOWN:* Unable to connect to ${smtpHost}`, smtpWebhook);
  }

  for (let i = 0; i < sites.length; i += BATCH_SIZE) {
    const batch = sites.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(checkOneSite));
    allResults.push(...batchResults);
  }

  const issues = allResults.filter(r => r.isIssue).length;
  const duration = ((Date.now() - start) / 1000).toFixed(2);

  await alertSlack(
    `✅ *Monitor Complete:* ${sites.length} sites in ${duration}s. (Issues: ${issues})`,
    statusWebhook
  );

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
