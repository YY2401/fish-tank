'use strict';
/* e2e 共用：起一個靜態伺服器 + 用本機 Chrome 開頁面，Twitch 聊天室與 Google 試算表都用假的 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.gs': 'text/plain; charset=utf-8', '.png': 'image/png' };
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function chromePath() { return CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }); }

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function launch() {
  const puppeteer = require('puppeteer-core');
  return puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--no-sandbox'] });
}

// 假的 Twitch 聊天室：頁面裡的 WebSocket 換成這個，測試用 __twitch.say(IRC 一行) 送訊息進去
const FAKE_TWITCH = `(() => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url; this.sent = [];
      sockets.push(this);
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(m) {
      this.sent.push(m);
      if (m.startsWith('JOIN')) setTimeout(() => this.emit(':tmi.twitch.tv ROOMSTATE ' + m.slice(5)), 0);
    }
    emit(line) { this.onmessage && this.onmessage({ data: line + '\\r\\n' }); }
    close() { this.onclose && this.onclose(); }
  }
  window.WebSocket = FakeSocket;
  window.__twitch = { sockets, say: (line) => sockets.forEach((s) => s.emit(line)) };
})();`;

// opts.twitch：換成假聊天室；opts.sheet(body) → 回應 JSON：攔截送到 Google Apps Script 的請求
async function newPage(browser, { width = 1280, height = 720, twitch = false, sheet = null } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => { page.errors.push(`native dialog: ${d.message()}`); d.dismiss(); });
  if (twitch) await page.evaluateOnNewDocument(FAKE_TWITCH);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return req.abort(); // 字型不影響測試，省時間
    if (u.startsWith('https://script.google.com/')) {
      if (!sheet) return req.abort();
      const out = sheet(JSON.parse(req.postData() || '{}'));
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
    }
    return req.continue();
  });
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { chromePath, serve, launch, newPage, sleep };
