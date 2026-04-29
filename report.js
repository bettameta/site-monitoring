// --- Monthly Report Generator ---
const fs = require('fs');
const https = require('https');
const ExcelJS = require('exceljs');

function getLogFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `log-${year}-${month}.json`;
}

function isLastDayOfMonth() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getMonth() !== now.getMonth();
}

function readLog() {
  const filename = getLogFilename();
  if (!fs.existsSync(filename)) {
    console.log(`No log file found: ${filename}`);
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

async function generateReport(data) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Site Alerts');

  sheet.columns = [
    { header: 'URL', key: 'url', width: 45 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Time', key: 'time', width: 12 },
    { header: 'Alert Type', key: 'alertType', width: 18 },
    { header: 'Response Time (s)', key: 'responseTime', width: 18 },
    { header: 'LCP', key: 'lcp', width: 10 },
    { header: 'FCP', key: 'fcp', width: 10 },
    { header: 'Google Score', key: 'googleScore', width: 18 },
  ];

  // Style header row
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
  sheet.getRow(1).height = 28;

  // Add data rows
  data.forEach((entry) => {
    const rawAlert = entry.alertType.replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();

    let alertType = rawAlert;
    if (rawAlert.includes('SLUGGISH') || rawAlert.includes('SLOW +2.5s')) alertType = 'SLUGGISH +2.5s';
    else if (rawAlert.includes('CAUTION') || rawAlert.includes('SLOW +5s')) alertType = 'CAUTION +5s';
    else if (rawAlert.includes('CRITICAL')) alertType = 'CRITICAL +10s';
    else if (rawAlert.includes('SITE ALERT')) alertType = 'SITE ALERT';

    // Convert response time to seconds
    const rawTime = entry.responseTime;
    let responseTimeSec = rawTime;
    if (typeof rawTime === 'string' && rawTime.includes('ms')) {
      responseTimeSec = (parseFloat(rawTime) / 1000).toFixed(2) + 's';
    } else if (rawTime >= 99000) {
      responseTimeSec = 'N/A';
    } else if (typeof rawTime === 'number') {
      responseTimeSec = (rawTime / 1000).toFixed(2) + 's';
    }

    const row = sheet.addRow({
      url: entry.url,
      date: entry.date,
      time: entry.time,
      alertType,
      responseTime: responseTimeSec,
      lcp: entry.lcp || 'N/A',
      fcp: entry.fcp || 'N/A',
      googleScore: entry.googleScore || 'N/A'
    });

    row.height = 22;

    // Background color per alert type
    let bgColor = 'FFFFFFFF';
    if (alertType.includes('SLUGGISH')) bgColor = 'FFFFF9D0';
    else if (alertType.includes('CAUTION')) bgColor = 'FFFFE8CC';
    else if (alertType.includes('CRITICAL')) bgColor = 'FFFFE0E0';
    else if (alertType.includes('SITE ALERT')) bgColor = 'FFFFCCCC';

    row.eachCell(cell => {
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      };
    });

    // Color code alert type text
    const alertCell = row.getCell('alertType');
    if (alertType.includes('SITE ALERT')) {
      alertCell.font = { bold: true, color: { argb: 'FFCC0000' } };
    } else if (alertType.includes('CRITICAL')) {
      alertCell.font = { bold: true, color: { argb: 'FFCC0000' } };
    } else if (alertType.includes('CAUTION')) {
      alertCell.font = { bold: true, color: { argb: 'FFCC5500' } };
    } else if (alertType.includes('SLUGGISH')) {
      alertCell.font = { bold: true, color: { argb: 'FF664400' } };
    }
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const filename = `report-${getLogFilename().replace('log-', '').replace('.json', '')}.xlsx`;
  await workbook.xlsx.writeFile(filename);
  return filename;
}

async function postToSlack(filename) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  const now = new Date();
  const monthName = now.toLocaleString('default', { month: 'long' });
  const year = now.getFullYear();
  const githubUrl = `https://github.com/Paradigm-Oral-Health/site-monitoring/raw/main/${filename}`;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      channel: channelId,
      text: `📊 *Site Monitor Monthly Report — ${monthName} ${year}*\nDownload: ${githubUrl}`
    });

    const req = https.request({
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        if (result.ok) {
          console.log('Message posted to Slack successfully!');
          resolve();
        } else {
          reject(new Error(`Slack error: ${result.error}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  if (!isLastDayOfMonth()) {
    console.log('Not the last day of the month — skipping report.');
    process.exit(0);
  }

  console.log('📊 Generating monthly report...');
  const data = readLog();
  console.log(`Found ${data.length} log entries`);
  const filename = await generateReport(data);
  console.log(`Report generated: ${filename}`);
  await postToSlack(filename);
  console.log('Report sent to Slack!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
