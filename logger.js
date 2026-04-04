// --- Logger ---
const fs = require('fs');
const path = require('path');

function getLogFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `log-${year}-${month}.json`;
}

function logAlert({ url, alertType, responseTime, lcp, fcp, googleScore }) {
  const filename = getLogFilename();
  const now = new Date();
  
  const entry = {
    url,
    date: now.toLocaleDateString('en-US'),
    time: now.toLocaleTimeString('en-US', { timeZone: 'America/Denver' }),
    alertType,
    responseTime: responseTime >= 99000 ? 'N/A' : `${responseTime}ms`,
    lcp: lcp || 'N/A',
    fcp: fcp || 'N/A',
    googleScore: googleScore || 'N/A'
  };

  let log = [];
  if (fs.existsSync(filename)) {
    log = JSON.parse(fs.readFileSync(filename, 'utf8'));
  }

  log.push(entry);
  fs.writeFileSync(filename, JSON.stringify(log, null, 2));
}

module.exports = { logAlert };
