'use strict';
/* 產生教學圖文用的截圖：用真的 index.html / tank.html，Twitch 聊天室與 Google 試算表換成模擬。執行：node docs/shots.js */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const H = require('../test/e2e/helpers');

const OUT = path.join(__dirname, 'img');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STORE = 'https://script.google.com/macros/s/AKfycb-example/exec';
// 教學裡的觀眾名字（看起來像真的聊天室）
const VIEWERS = ['小魚乾', '阿宅不睡覺', 'Momo_TW', '路過的貓', 'kiwi_kiwi', '布丁狗', '大吉大利', 'SunnyDay', '奶茶三分糖', 'Leo0218', '海綿寶寶粉', '雞排不加辣', 'yuki_chan', '熬夜冠軍', '蛋餅王', 'ChillGuy', '芒果冰', '小籠包', 'Neko123', '水母控'];
// 示範用的圖（自己畫的，不用 Twitch 真的表情或別人的大頭貼）：外部圖片網址都換成這幾張
const SAMPLE = (f) => fs.readFileSync(path.join(__dirname, 'samples', f));
const IMAGES = {
  'https://img.example.com/chick.png': 'chick.svg',
  'https://static-cdn.jtvnw.net/emoticons/': 'smile.svg',
  'https://static-cdn.jtvnw.net/jtv_user_pictures/': 'pfp.svg',
};
const CHICK = 'https://img.example.com/chick.png';
const LINES = ['晚安～', '這魚缸好可愛', '我是哪一隻', '+1', '主播加油', '哈哈哈哈', '今天玩什麼', '好療癒'];

async function newPage(browser, w, h, scale = 2) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.evaluateOnNewDocument(H.FAKE_TWITCH);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('https://script.google.com/')) {
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, profiles: { a: {}, b: {}, c: {} } }) });
    }
    if (u.startsWith('https://decapi.me/')) {
      return req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'https://static-cdn.jtvnw.net/jtv_user_pictures/demo-profile_image.png' });
    }
    const img = Object.keys(IMAGES).find((k) => u.startsWith(k));
    if (img) return req.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: SAMPLE(IMAGES[img]) });
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

  await page.click('[data-theme="tropical"]');
  await mark(page, ['#themes', '#layers']);
  await shotRange(page, 'setup-look', `${leftSec(2)} h2`, 'label:has(#bgimg)');
  await page.click('[data-theme="ocean"]');

  // 色碼表：勾「自己選顏色」，打開第一個顏色的色票
  await page.click('#customColor');
  await page.click('#colorRow .cf-sw');
  await mark(page, []);
  const colorClip = await page.evaluate(() => {
    const a = document.getElementById('customColor').closest('label').getBoundingClientRect();
    const pop = document.querySelector('#colorRow .cf-pop').getBoundingClientRect();
    const row = document.getElementById('colorRow').getBoundingClientRect();
    const card = document.getElementById('colorRow').closest('section').getBoundingClientRect();
    return { x: card.left, y: a.top - 10 + scrollY, width: card.width, height: Math.max(pop.bottom, row.bottom) - a.top + 20 };
  });
  await page.screenshot({ path: path.join(OUT, 'setup-colors.png'), clip: colorClip });
  console.log('shot setup-colors');
  await page.click('h1');
  await page.click('#customColor');

  await mark(page, ['#event']);
  await shotRange(page, 'setup-deco', '#decoLbl', 'label:has(#event)');

  // 物件編輯：加幾個物件、選一個（預覽上出現黃色虛線框）
  await page.click('#objPalette [data-obj="ship"]');
  await page.click('#objPalette [data-obj="starfish"]');
  await page.click('#objPalette [data-obj="helmet"]');
  await page.$eval('#objSize', (e) => { e.value = '1.4'; e.dispatchEvent(new Event('input')); });
  await sleep(2500);
  await mark(page, ['#objPalette', '#objPanel']);
  await shotEl(page, 'setup-objects-preview', '#preview');
  await shotRange(page, 'setup-objects', '#objEditor h2', '#objEditor .obj-foot', 14, 10);
  await mark(page, []);
  page.once('dialog', (d) => d.accept()); // 「全部清掉」會先問一次
  await page.click('#objClear');

  // 上傳一張圖（示範用的小雞），會縮小後直接放進網址
  await page.type('#skinName', '小雞');
  await (await page.$('#skinFile')).uploadFile(path.join(__dirname, 'samples', 'chick.svg'));
  await page.waitForFunction(() => { const i = document.querySelector('#skins img'); return i && i.naturalWidth; });
  await mark(page, ['#skins .skin', '.skin-add label']);
  await shotRange(page, 'setup-skins', `${leftSec(3)} h2`, '#skinMsg', 14, 1);
  await mark(page, ['#pfp']);
  await shotRange(page, 'setup-avatar', '#avatarLbl', 'label:has(#pfp)');
  await mark(page, ['label:has(#submit)']);
  await shotRange(page, 'setup-viewer', '#wearLbl', 'label:has(#submit)');

  await page.waitForFunction(() => /正在偵測/.test(document.getElementById('listenText').textContent));
  await page.evaluate(() => window.__twitch.say('@custom-reward-id=8f2c41d0-6a1e-4b8e-9c55-2d7f0e3a9b12;display-name=小魚乾 :fish01!fish01@fish01.tmi.twitch.tv PRIVMSG #yy2401 :鯨魚'));
  await page.waitForSelector('#rewards .reward');
  await page.select('#rewards .reward select', 'rare');
  await mark(page, ['#rewards .reward']);
  await shotRange(page, 'setup-rare', `${leftSec(4)} .lbl`, '#rewards');

  await page.click('#advanced summary'); // 試算表收在「進階」裡
  await mark(page, ['#copyScript']);
  await shotRange(page, 'setup-sheet-copy', `${leftSec(5)} ol li:nth-child(1)`, `${leftSec(5)} ol li:nth-child(2)`, 10, 6);
  await page.type('#store', STORE);
  await page.click('#testStore');
  await page.waitForFunction(() => /連上了/.test(document.getElementById('storeMsg').textContent));
  await mark(page, ['#store', '#testStore', '#storeMsg']);
  await shotRange(page, 'setup-sheet-test', `${leftSec(5)} ol li:nth-child(3)`, '#storeMsg', 10, 8);
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

  // 自訂魚種與頭像
  await openTank(`deco=coral,bubbler&tip=0&skin=${encodeURIComponent('小雞|' + CHICK)}`);
  await fill(12);
  await tank.evaluate(() => FishTank.advance(6)); // 換魚種有 5 秒冷卻
  await tank.evaluate(() => {
    const say = (i, name, text, tags) => FishTank.handleChat({ login: 'v' + i, display: name, text, badges: {}, tags });
    say(0, '小魚乾', '!小雞'); say(4, 'kiwi_kiwi', '!小雞'); say(9, 'Leo0218', '!小雞');
    say(2, 'Momo_TW', '!頭像 :)', { emotes: '1:4-5' }); say(6, '大吉大利', '!頭像 :)', { emotes: '1:4-5' });
    say(0, '小魚乾', '!頭像 :)', { emotes: '1:4-5' });
    say(5, '布丁狗', '!頭像 大頭貼'); say(10, '海綿寶寶粉', '!頭像 大頭貼');
  });
  await sleep(800);
  await tank.evaluate(() => FishTank.advance(10));
  await sleep(600);
  // 只截魚最多的中間那塊，說明書裡才看得清楚小雞和頭像
  const box = await tank.evaluate(() => {
    const fs = [...FishTank.fishes.values()];
    const xs = fs.map((f) => f.x), ys = fs.map((f) => f.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = 760, h = 430;
    return { x: Math.max(0, Math.min(innerWidth - w, cx - w / 2)), y: Math.max(0, Math.min(innerHeight - h, cy - h / 2)), width: w, height: h };
  });
  await tank.screenshot({ path: path.join(OUT, 'tank-custom.png'), clip: box });
  console.log('shot tank-custom');

  // 魚缸物件：沉船、遺跡、潛水頭盔…組合出來的魚缸
  const layout = ['pillar~0.06~~1.1~0~', 'pillar~0.13~~0.7~1~', 'rock~0.1~~1~0~', 'ship~0.33~~1.2~0~', 'plant~0.5~~1.1~0~', 'coral~0.58~~1.2~0~',
    'helmet~0.7~~1.1~0~', 'anchor~0.8~~1~1~', 'shell~0.66~~1~0~', 'starfish~0.88~~1.2~0~', 'chest~0.95~~0.9~1~', 'bubbler~0.45~~1.4~0~',
    'coral~0.22~~0.8~1~ffb347', 'starfish~0.26~~1~0~ffd23f'].join('|');
  await openTank(`theme=tropical&tip=0&weed=1&objs=${encodeURIComponent(layout)}`);
  await fill(8);
  await tank.evaluate(() => FishTank.advance(8));
  await sleep(400);
  await shotPage(tank, 'tank-objects');

  // 觀眾自訂：副色、大小、表情、名牌
  await openTank('objs=&tip=0&weed=1&scale=1.6');
  await tank.evaluate(() => {
    const looks = [['小魚乾', '!金魚', ['!副色 藍', '!表情 愛心眼', '!大小 大']], ['阿宅不睡覺', '!小丑魚', ['!表情 想睡', '!名牌 #ffd84a']],
      ['Momo_TW', '!河豚', ['!表情 星星眼', '!副色 粉']], ['路過的貓', '!神仙魚', ['!表情 生氣', '!副色 #ff4a4a', '!戴 皇冠', '!配件色 青']],
      ['kiwi_kiwi', '!鯊魚', ['!表情 開心', '!大小 小', '!名牌 #7cf5a0']], ['布丁狗', '!金魚', ['!表情 暈', '!副色 彩虹']], ['大吉大利', '!錦鯉', ['!表情 驚訝']]];
    looks.forEach(([name, sp, cmds], i) => {
      const say = (t) => FishTank.handleChat({ login: 'x' + i, display: name, text: t, badges: { broadcaster: true } });
      say('!魚'); say(sp); cmds.forEach(say);
    });
  });
  await tank.evaluate(() => FishTank.advance(10));
  await sleep(500);
  const xbox = await tank.evaluate(() => {
    const fs = [...FishTank.fishes.values()];
    const xs = fs.map((f) => f.x), ys = fs.map((f) => f.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = 860, h = 480;
    return { x: Math.max(0, Math.min(innerWidth - w, cx - w / 2)), y: Math.max(0, Math.min(innerHeight - h, cy - h / 2)), width: w, height: h };
  });
  await tank.screenshot({ path: path.join(OUT, 'tank-looks.png'), clip: xbox });
  console.log('shot tank-looks');

  // 觀眾打扮：配件與花紋
  await openTank('deco=coral&tip=0&weed=1&scale=1.6');
  await tank.evaluate(() => {
    const looks = [['小魚乾', '!金魚', '帽子', '條紋'], ['阿宅不睡覺', '!小丑魚', '皇冠', ''], ['Momo_TW', '!河豚', '眼鏡', '斑點'], ['路過的貓', '!神仙魚', '蝴蝶結', '愛心'],
      ['kiwi_kiwi', '!鯊魚', '海盜帽', ''], ['布丁狗', '!水母', '花', '星星'], ['大吉大利', '!金魚', '耳機', '斑點'], ['SunnyDay', '!小丑魚', '光環', '']];
    looks.forEach(([name, sp, wear, pat], i) => {
      const say = (t) => FishTank.handleChat({ login: 'w' + i, display: name, text: t, badges: {} });
      say('!魚'); say(sp); say('!戴 ' + wear); if (pat) say('!花紋 ' + pat);
    });
  });
  await tank.evaluate(() => FishTank.advance(10));
  await sleep(500);
  const wbox = await tank.evaluate(() => {
    const fs = [...FishTank.fishes.values()];
    const xs = fs.map((f) => f.x), ys = fs.map((f) => f.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = 860, h = 480;
    return { x: Math.max(0, Math.min(innerWidth - w, cx - w / 2)), y: Math.max(0, Math.min(innerHeight - h, cy - h / 2)), width: w, height: h };
  });
  await tank.screenshot({ path: path.join(OUT, 'tank-wear.png'), clip: wbox });
  console.log('shot tank-wear');

  // 配色主題：四種排成 2×2 一張圖
  const tmp = [];
  for (const th of ['tropical', 'deep', 'sunset', 'candy']) {
    await openTank(`theme=${th}&deco=castle,coral&tip=0`);
    await fill(8);
    await tank.evaluate(() => FishTank.advance(8));
    await sleep(300);
    const f = path.join(OUT, `_theme-${th}.png`);
    await tank.screenshot({ path: f });
    tmp.push(f);
  }
  const ff = process.env.FFMPEG_PATH || 'ffmpeg';
  execFileSync(ff, ['-y', '-loglevel', 'error', ...tmp.flatMap((f) => ['-i', f]), '-filter_complex', '[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack,scale=1920:-1', path.join(OUT, 'tank-themes.png')]);
  tmp.forEach((f) => fs.unlinkSync(f));
  console.log('shot tank-themes');

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
