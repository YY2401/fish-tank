'use strict';
/* 設定頁（index.html）：填設定 → OBS 網址、偵測忠誠點品項、試算表程式碼與測試連線 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

if (!H.chromePath()) {
  test('e2e（找不到 Chrome，略過；可用 CHROME_PATH 指定）', { skip: true }, () => {});
} else {
  let srv, browser;
  before(async () => { srv = await H.serve(); browser = await H.launch(); });
  after(async () => { await browser.close(); srv.server.close(); });

  async function open(t, opts = {}) {
    const page = await H.newPage(browser, { width: 1280, height: 900, ...opts });
    t.after(() => page.close());
    await page.goto(`${srv.url}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    return page;
  }
  const obsUrl = async (page) => new URL(await page.$eval('#url', (e) => e.value)).searchParams;
  async function typeInto(page, sel, text) {
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(sel, text);
  }

  test('填設定產生正確的 OBS 網址；預覽不帶試算表', async (t) => {
    const page = await open(t);
    await typeInto(page, '#channel', 'https://www.twitch.tv/YY2401');
    await page.click('#auto');
    await page.select('#bg', 'none');
    await page.click('[data-area="0.55,0.03,0.6,0.02"]'); // 右下角
    await typeInto(page, '#event', '0');
    await page.click('#decos input[value="castle"]');
    const p = await obsUrl(page);
    assert.equal(p.get('channel'), 'yy2401');
    assert.equal(p.get('auto'), '0');
    assert.equal(p.get('bg'), 'none');
    assert.deepEqual(['top', 'bottom', 'left', 'right'].map((k) => p.get(k)), ['0.55', '0.03', '0.6', '0.02']);
    assert.equal(p.get('event'), '0');
    assert.equal(p.get('deco'), 'castle,chest,coral,bubbler');
    assert.ok(!p.has('demo'));
    await page.waitForFunction(() => /demo=1/.test(document.getElementById('preview').src));
    // 全畫面按鈕把範圍清掉
    await page.click('[data-area="0,0,0,0"]');
    assert.ok(!(await obsUrl(page)).has('top'));
    assert.deepEqual(page.errors, []);
  });

  test('重新整理後設定還在', async (t) => {
    const page = await open(t);
    await typeInto(page, '#channel', 'yy2401');
    await typeInto(page, '#bits', '300');
    await page.reload({ waitUntil: 'load' });
    const p = await obsUrl(page);
    assert.equal(p.get('channel'), 'yy2401');
    assert.equal(p.get('bits'), '300');
  });

  test('偵測忠誠點品項（模擬聊天室），選了動作就寫進 OBS 網址', async (t) => {
    const page = await open(t, { twitch: true });
    await typeInto(page, '#channel', 'yy2401');
    await page.waitForFunction(() => /正在偵測/.test(document.getElementById('listenText').textContent));
    await page.evaluate(() => window.__twitch.say('@custom-reward-id=abc-123;display-name=測試觀眾 :v1!v1@v1.tmi.twitch.tv PRIVMSG #yy2401 :鯨魚'));
    await page.waitForSelector('#rewards .reward');
    assert.match(await page.$eval('#rewards .reward b', (e) => e.textContent), /測試觀眾：「鯨魚」/);
    await page.select('#rewards .reward select', 'rare');
    assert.equal((await obsUrl(page)).get('rw'), 'abc-123:rare');
    await page.click('#rewards .reward button'); // 移除
    assert.ok(!(await obsUrl(page)).has('rw'));
  });

  test('試算表：複製的程式碼帶入暗號，測試連線成功後網址帶上試算表', async (t) => {
    let key = null;
    const page = await open(t, { sheet: (body) => { key = body.key; return { ok: true, profiles: { a: {}, b: {} } }; } });
    await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (s) => { window.__copied = s; }; });
    await page.click('#advanced summary');
    await page.click('#copyScript');
    await page.waitForFunction(() => window.__copied.length > 0);
    const code = await page.evaluate(() => window.__copied);
    assert.ok(!code.includes('__KEY__'), '暗號要填進去');
    const k = code.match(/const KEY = '([^']+)'/)[1];
    assert.ok(k.length >= 12);

    await typeInto(page, '#store', 'https://script.google.com/macros/s/TEST/exec');
    await page.click('#testStore');
    await page.waitForFunction(() => /連上了/.test(document.getElementById('storeMsg').textContent));
    assert.equal(key, k, '測試連線要用同一組暗號');
    assert.match(await page.$eval('#storeMsg', (e) => e.textContent), /2 隻魚/);
    const p = await obsUrl(page);
    assert.equal(p.get('store'), 'https://script.google.com/macros/s/TEST/exec');
    assert.equal(p.get('skey'), k);
  });

  test('試算表網址打錯會提醒', async (t) => {
    const page = await open(t);
    await page.click('#advanced summary');
    await typeInto(page, '#store', 'https://example.com/x');
    await page.click('#testStore');
    assert.match(await page.$eval('#storeMsg', (e) => e.textContent), /script\.google\.com/);
  });

  test('自訂魚種：貼圖片網址加入，名字重複或跟內建魚種撞名會擋；大頭貼開關寫進網址', async (t) => {
    const page = await open(t, { routes: { 'https://img.example.com/': {} } });
    await typeInto(page, '#skinName', '小雞');
    await typeInto(page, '#skinUrl', 'https://img.example.com/chick.png');
    await page.click('#skinAdd');
    assert.deepEqual((await obsUrl(page)).getAll('skin'), ['小雞|https://img.example.com/chick.png']);
    assert.equal(await page.$$eval('#skins .skin', (r) => r.length), 1);

    await typeInto(page, '#skinName', '小雞');
    await typeInto(page, '#skinUrl', 'https://img.example.com/b.png');
    await page.click('#skinAdd');
    assert.match(await page.$eval('#skinMsg', (e) => e.textContent), /已經有/);
    await typeInto(page, '#skinName', '鯊魚');
    await page.click('#skinAdd');
    assert.match(await page.$eval('#skinMsg', (e) => e.textContent), /重複/);
    await typeInto(page, '#skinName', '小狗');
    await typeInto(page, '#skinUrl', 'http://img.example.com/dog.png');
    await page.click('#skinAdd');
    assert.match(await page.$eval('#skinMsg', (e) => e.textContent), /https/);

    await page.click('#pfp');
    assert.equal((await obsUrl(page)).get('pfp'), '0');
    await page.click('#skins .skin button'); // 移除
    assert.deepEqual((await obsUrl(page)).getAll('skin'), []);
    assert.deepEqual(page.errors, []);
  });

  test('自訂魚種：上傳圖片不用任何帳號，縮小後直接放進 OBS 網址', async (t) => {
    const page = await open(t);
    const file = require('node:path').join(require('node:os').tmpdir(), 'fishtank-big.png');
    // 一張 600×400 的圖：上傳後要縮到最寬 160
    const big = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#ffcc00'; g.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; });
    require('node:fs').writeFileSync(file, Buffer.from(big, 'base64'));
    await typeInto(page, '#skinName', '小雞');
    await (await page.$('#skinFile')).uploadFile(file);
    await page.waitForFunction(() => /加好了/.test(document.getElementById('skinMsg').textContent));
    const skin = (await obsUrl(page)).getAll('skin')[0];
    assert.match(skin, /^小雞\|data:image\/(webp|png);base64,/);
    const size = await page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = u; }), skin.split('|')[1]);
    assert.deepEqual(size, [160, 107]);
    assert.ok(skin.length < 8000, '縮小後的圖要夠小，網址才放得下');
    assert.equal(await page.$eval('#urlMsg', (e) => e.textContent), '');
  });

  test('魚缸外觀：配色、自訂顏色、畫面元素、海草、背景圖片都寫進網址', async (t) => {
    const page = await open(t);
    await page.click('[data-theme="sunset"]');
    let p = await obsUrl(page);
    assert.equal(p.get('theme'), 'sunset');
    assert.ok(!p.has('water'));
    assert.equal(await page.$eval('#colorRow', (e) => getComputedStyle(e).display), 'none', '沒勾「自己選顏色」時不顯示色票');
    await page.click('#customColor');
    assert.notEqual(await page.$eval('#colorRow', (e) => getComputedStyle(e).display), 'none');
    p = await obsUrl(page);
    assert.equal(p.get('water'), '#ff9a6b,#4a2a6a', '自訂顏色從目前的主題開始');
    assert.equal(p.get('sand'), '#e8b98a');
    await page.click('#layers input[value="rays"]');
    await page.click('#layers input[value="rocks"]');
    await page.select('#weed', '3');
    await typeInto(page, '#bgimg', 'https://img.example.com/bg.jpg');
    p = await obsUrl(page);
    assert.equal(p.get('hide'), 'rays,rocks');
    assert.equal(p.get('weed'), '3');
    assert.equal(p.get('bgimg'), 'https://img.example.com/bg.jpg');
    await page.click('#submit');
    assert.equal((await obsUrl(page)).get('submit'), '0');
    await page.reload({ waitUntil: 'load' });
    p = await obsUrl(page);
    assert.equal(p.get('theme'), 'sunset', '重新整理後還在');
    assert.equal(p.get('hide'), 'rays,rocks');
    assert.equal(await page.$eval('#layers input[value="rays"]', (e) => e.checked), false);
    assert.deepEqual(page.errors, []);
  });
}
