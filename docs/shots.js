'use strict';
/* 產生教學圖文用的截圖：用真的 index.html / tank.html，Twitch 聊天室與 Google 試算表換成模擬。執行：node docs/shots.js */
const path = require('node:path');
const fs = require('node:fs');
const H = require('../test/e2e/helpers');

const OUT = path.join(__dirname, 'img');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STORE = 'https://script.google.com/macros/s/AKfycb-example/exec';
// 教學裡的觀眾名字（看起來像真的聊天室）
const VIEWERS = ['小魚乾', '阿宅不睡覺', 'Momo_TW', '路過的貓', 'kiwi_kiwi', '布丁狗', '大吉大利', 'SunnyDay', '奶茶三分糖', 'Leo0218', '海綿寶寶粉', '雞排不加辣', 'yuki_chan', '熬夜冠軍', '蛋餅王', 'ChillGuy', '芒果冰', '小籠包', 'Neko123', '水母控'];
const LINES = ['晚安～', '這魚缸好可愛', '我是哪一隻', '+1', '主播加油', '哈哈哈哈', '今天玩什麼', '好療癒'];

async function newPage(browser, w, h, scale = 2) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.evaluateOnNewDocument(H.FAKE_TWITCH);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith('https://script.google.com/')) {
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, profiles: { a: {}, b: {}, c: {} } }) });
    }
    return req.continue();
  });
  return page;
}

// 把元素框起來（教學裡「要點的地方」）
async function mark(page, sels) {
  await page.evaluate((sels) => {
    document.querySelectorAll('[data-mark]').forEach((e) => { e.style.outline = ''; e.removeAttribute('data-mark'); });
    for (const s of sels) {
      const e = document.querySelector(s);
      e.setAttribute('data-mark', '');
      e.style.outline = '3px solid #ff8a2a';
      e.style.outlineOffset = '3px';
      e.style.borderRadius = '6px';
    }
  }, sels);
}
async function shotEl(page, name, sel) {
  const el = await page.$(sel);
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}
// 只截一個區塊裡「從 from 到 to」那一段（左右跟著所在的卡片），教學圖才不會一大張縮到看不清楚
async function shotRange(page, name, from, to, pad = 14, padBottom = pad) {
  const clip = await page.evaluate((from, to, pad, padBottom) => {
    const a = document.querySelector(from).getBoundingClientRect();
    const b = document.querySelector(to).getBoundingClientRect();
    const card = document.querySelector(from).closest('section').getBoundingClientRect();
    const top = Math.min(a.top, b.top) - pad, bottom = Math.max(a.bottom, b.bottom) + padBottom;
    return { x: card.left, y: top + scrollY, width: card.width, height: bottom - top };
  }, from, to, pad, padBottom);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  console.log('shot', name);
}
async function shotPage(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await H.serve();
  const browser = await H.launch();

  // ───────── 設定頁 ─────────
  const page = await newPage(browser, 1280, 1000);
  await page.goto(`${srv.url}/index.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.addStyleTag({ content: '.left > section, .right > section { scroll-margin: 0 }' });
  const sec = (n) => `main section:nth-of-type(${n})`;
  const leftSec = (n) => `.left > section:nth-of-type(${n})`;
  const rightSec = (n) => `.right > section:nth-of-type(${n})`;

  await page.type('#channel', 'yy2401');
  await mark(page, ['#channel']);
  await shotRange(page, 'setup-channel', `${leftSec(1)} h2`, '#tip');

  await page.click('[data-area="0.55,0.03,0.6,0.02"]');
  await mark(page, ['.presets', '.area']);
  await shotRange(page, 'setup-area', 'label:has(#bg) > span', '.area', 14, 10);
  await page.click('[data-area="0,0,0,0"]');

  await mark(page, ['#decos', '#event']);
  await shotEl(page, 'setup-deco', leftSec(2));

  await page.waitForFunction(() => /正在偵測/.test(document.getElementById('listenText').textContent));
  await page.evaluate(() => window.__twitch.say('@custom-reward-id=8f2c41d0-6a1e-4b8e-9c55-2d7f0e3a9b12;display-name=小魚乾 :fish01!fish01@fish01.tmi.twitch.tv PRIVMSG #yy2401 :鯨魚'));
  await page.waitForSelector('#rewards .reward');
  await page.select('#rewards .reward select', 'rare');
  await mark(page, ['#rewards .reward']);
  await shotRange(page, 'setup-rare', `${leftSec(3)} .lbl`, '#rewards');

  await mark(page, ['#copyScript']);
  await shotRange(page, 'setup-sheet-copy', `${leftSec(4)} ol li:nth-child(1)`, `${leftSec(4)} ol li:nth-child(2)`, 10, 6);
  await page.type('#store', STORE);
  await page.click('#testStore');
  await page.waitForFunction(() => /連上了/.test(document.getElementById('storeMsg').textContent));
  await mark(page, ['#store', '#testStore', '#storeMsg']);
  await shotRange(page, 'setup-sheet-test', `${leftSec(4)} ol li:nth-child(3)`, '#storeMsg', 10, 8);
  // 試算表截完就清掉，後面的 OBS 網址比較短
  await page.click('#store', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.evaluate(() => { const e = document.getElementById('store'); e.dispatchEvent(new Event('input')); });

  // 截圖用正式網址（測試伺服器的位址對讀者沒意義）
  await page.evaluate(() => { const u = document.getElementById('url'); u.value = u.value.replace(location.origin + '/', 'https://yy2401.github.io/fish-tank/'); });
  await mark(page, ['#copy']);
  await shotEl(page, 'setup-obs', rightSec(1));

  await mark(page, []);
  await page.waitForFunction(() => /demo=1/.test(document.getElementById('preview').src));
  await sleep(2500);
  await page.evaluate(() => scrollTo(0, 0));
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await sleep(1500);
  await shotPage(page, 'setup-overview'); // 一打開看到的樣子
  await page.close();

  // ───────── 水族箱畫面 ─────────
  const tank = await newPage(browser, 1280, 720, 1.5);
  const openTank = async (query) => {
    await tank.goto(`${srv.url}/tank.html?channel=yy2401&event=0&${query}`, { waitUntil: 'networkidle0' });
    await tank.evaluate(() => localStorage.clear());
    await tank.reload({ waitUntil: 'networkidle0' });
    await tank.waitForFunction(() => window.FishTank);
    await tank.addStyleTag({ content: '.status{display:none!important}' }); // 「已連上聊天室」提示不入鏡
  };
  const fill = (n, extra = []) => tank.evaluate((names, lines, extra) => {
    const skins = ['!金魚', '!小丑魚', '!河豚', '!神仙魚', '!水母', '!鯊魚', '!顏色 粉', '!顏色 彩虹', '!顏色 青', '!顏色 金'];
    names.forEach((n, i) => {
      const login = 'v' + i;
      const badges = { sub: i % 4 === 0, vip: i === 7, mod: i === 3 };
      FishTank.handleChat({ login, display: n, text: '!魚', badges });
      FishTank.handleChat({ login, display: n, text: skins[i % skins.length], badges });
    });
    for (const [login, display, text, badges] of extra) FishTank.handleChat({ login, display, text, badges });
  }, VIEWERS.slice(0, n), LINES, extra);
  const talk = (k) => tank.evaluate((names, lines, k) => {
    for (let i = 0; i < k; i++) FishTank.handleChat({ login: 'v' + (i * 3 % names.length), display: names[i * 3 % names.length], text: lines[i % lines.length], badges: {} });
  }, VIEWERS, LINES, k);

  await openTank('deco=castle,chest,coral,bubbler&tip=1');
  await fill(18, [['yy2401', 'YY2401', '!鯨魚', { broadcaster: true }]]);
  await tank.evaluate(() => FishTank.advance(12));
  await talk(4);
  await tank.evaluate(() => FishTank.advance(0.6));
  await sleep(300);
  await shotPage(tank, 'tank-full');

  await tank.evaluate(() => FishTank.startEvent('shark', { display: 'YY2401' }));
  await tank.evaluate(() => FishTank.advance(2.6));
  await sleep(200);
  await shotPage(tank, 'tank-shark');
  await tank.evaluate(() => FishTank.advance(15));

  await tank.evaluate(() => {
    FishTank.handleChat({ login: 'v1', display: '阿宅不睡覺', notice: true, kind: 'sub' });
    const f = FishTank.fishes.get('v1'); // 剛解鎖的魚移到畫面中間
    Object.assign(f, { x: innerWidth * 0.5, y: innerHeight * 0.48, tx: innerWidth * 0.62, ty: innerHeight * 0.48, vx: 30, vy: 0, retarget: 9 });
  });
  await tank.evaluate(() => FishTank.advance(0.3));
  await sleep(500);
  await shotPage(tank, 'tank-rare');

  await sleep(6000); // 等上一個橫幅消失
  await tank.evaluate(() => FishTank.handleChat({ login: 'v2', display: 'Momo_TW', text: '!fishhelp', badges: {} }));
  await sleep(600);
  await shotPage(tank, 'tank-help');

  // 角落魚缸疊在遊戲畫面上（背景用一張示意的遊戲畫面）
  await openTank('deco=castle,coral,bubbler&top=0.5&bottom=0.03&left=0.55&right=0.02&tip=1');
  await tank.addStyleTag({ content: 'html.transparent body{background:linear-gradient(160deg,#3b4a6b,#1d2438 60%,#121621)!important}body::before{content:"（這裡是你的遊戲畫面）";position:fixed;left:6%;top:40%;color:#ffffff55;font:700 34px "Noto Sans TC",sans-serif}' });
  await fill(10);
  await tank.evaluate(() => FishTank.advance(12));
  await talk(2);
  await tank.evaluate(() => FishTank.advance(0.5));
  await sleep(300);
  await shotPage(tank, 'tank-corner');

  // 測試面板
  await openTank('demo=1&tip=0');
  await fill(8);
  await tank.evaluate(() => FishTank.advance(10));
  await tank.type('[name=text]', '!跳');
  await tank.evaluate(() => { document.querySelectorAll('[data-mark]').forEach((e) => e.removeAttribute('data-mark')); const d = document.getElementById('demo'); d.style.outline = '3px solid #ff8a2a'; d.style.outlineOffset = '3px'; });
  await sleep(300);
  await shotPage(tank, 'tank-demo');

  await browser.close();
  srv.server.close();
})();
