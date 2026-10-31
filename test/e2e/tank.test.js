'use strict';
/* 水族箱畫面（tank.html）：用真的 Chrome 開，模擬聊天室打指令，檢查魚的狀態 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const C = require('../../fish-core.js');

if (!H.chromePath()) {
  test('e2e（找不到 Chrome，略過；可用 CHROME_PATH 指定）', { skip: true }, () => {});
} else {
  let srv, browser;
  before(async () => { srv = await H.serve(); browser = await H.launch(); });
  after(async () => { await browser.close(); srv.server.close(); });

  async function open(t, query = '', opts = {}) {
    const page = await H.newPage(browser, opts);
    t.after(() => page.close());
    await page.goto(`${srv.url}/tank.html?demo=1&event=0&tip=0${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await page.evaluate(() => localStorage.clear());
    return page;
  }
  const chat = (page, login, text, extra = {}) =>
    page.evaluate((login, text, extra) => FishTank.handleChat({ login, display: extra.display || login, text, badges: extra.badges || {}, tags: extra.tags }), login, text, extra);
  const fish = (page, login) => page.evaluate((l) => {
    const f = FishTank.fishes.get(l);
    return f && { species: f.species, color: f.color, size: f.size, state: f.state, x: f.x, y: f.y, say: f.say, unlocked: f.unlocked, leaving: f.leaving, flee: f.flee, avatar: f.avatar };
  }, login);
  const advance = (page, sec) => page.evaluate((s) => FishTank.advance(s), sec);
  const peek = (page) => page.evaluate(() => FishTank.peek());
  const many = (page, n, prefix = 'v') => page.evaluate((n, prefix) => { for (let i = 0; i < n; i++) FishTank.handleChat({ login: prefix + i, display: prefix + i, text: '!魚', badges: {} }); }, n, prefix);

  test('載入沒有錯誤；講話就變成魚，聊天內容變成泡泡', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '哈囉大家');
    const f = await fish(page, 'amy');
    assert.ok(f, '應該有 amy 的魚');
    assert.equal(f.say, '哈囉大家');
    assert.deepEqual(page.errors, []);
  });

  test('auto=0 時要打 !魚 才加入；機器人帳號不會變成魚', async (t) => {
    const page = await open(t, '&auto=0');
    await chat(page, 'bob', '路過');
    assert.equal(await fish(page, 'bob'), undefined);
    await chat(page, 'bob', '!魚');
    assert.ok(await fish(page, 'bob'));
    await chat(page, 'nightbot', '!魚');
    assert.equal(await fish(page, 'nightbot'), undefined);
  });

  test('換魚種、換顏色；重新整理後同一個人外觀還記得', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!鯊魚');
    await chat(page, 'amy', '!顏色 粉');
    let f = await fish(page, 'amy');
    assert.equal(f.species, 'shark');
    assert.equal(f.color, '#ff8ccf');
    await H.sleep(800); // 外觀寫進瀏覽器有 0.5 秒延遲
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await chat(page, 'amy', '我回來了');
    f = await fish(page, 'amy');
    assert.equal(f.species, 'shark');
    assert.equal(f.color, '#ff8ccf');
  });

  test('稀有魚種：一般觀眾被擋下並說明怎麼解鎖，實況主可以直接用', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    const before = (await fish(page, 'amy')).species;
    await chat(page, 'amy', '!鯨魚');
    const f = await fish(page, 'amy');
    assert.equal(f.species, before);
    assert.match(f.say, /稀有魚種/);
    await chat(page, 'boss', '!鯨魚', { badges: { broadcaster: true } });
    assert.equal((await fish(page, 'boss')).species, 'whale');
  });

  test('動作：跳出水面再落回、睡覺沉到底、餵食吃了會變大', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await advance(page, 3);
    await chat(page, 'amy', '!跳');
    await advance(page, 0.5);
    const { area } = await peek(page);
    assert.ok((await fish(page, 'amy')).y < area.surfaceY, '跳的時候要高過水面');
    await advance(page, 4);
    assert.equal((await fish(page, 'amy')).state, 'swim');

    await chat(page, 'amy', '!睡');
    await advance(page, 15);
    const sleeping = await fish(page, 'amy');
    assert.equal(sleeping.state, 'sleep');
    assert.ok(sleeping.y > area.floorY - 60, '睡覺要沉到底');

    await chat(page, 'amy', '!餵');
    assert.ok((await peek(page)).food > 0);
    await advance(page, 30);
    assert.ok((await fish(page, 'amy')).size > 1, '吃到飼料要變大');
  });

  test('抱抱：游到對方旁邊，結束後恢復閒逛', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await chat(page, 'bob', '!魚');
    await advance(page, 2);
    await chat(page, 'amy', '!抱 @bob');
    assert.equal((await fish(page, 'amy')).state, 'hug');
    let done = false;
    for (let i = 0; i < 24 && !done; i++) {
      await advance(page, 0.5);
      done = (await fish(page, 'amy')).state === 'swim';
    }
    assert.ok(done, '12 秒內要抱到');
    const a = await fish(page, 'amy'), b = await fish(page, 'bob');
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 150, '抱完應該在對方旁邊');
  });

  test('大事件：鯊魚讓魚逃跑、漩渦全部捲進去、寶箱讓搶到的魚解鎖稀有魚種', async (t) => {
    const page = await open(t);
    await many(page, 12);
    await advance(page, 3);

    await page.evaluate(() => FishTank.startEvent('shark'));
    assert.match((await peek(page)).banner, /鯊魚出沒/);
    // 鯊魚橫越整個畫面的過程中，至少要有一隻魚逃過
    let fled = false;
    for (let i = 0; i < 20 && !fled; i++) {
      await advance(page, 0.5);
      fled = await page.evaluate(() => [...FishTank.fishes.values()].some((f) => f.flee > 0));
    }
    assert.ok(fled, '鯊魚經過時要有魚逃跑');
    await advance(page, 15);
    assert.equal((await peek(page)).ev, null);

    await page.evaluate(() => FishTank.startEvent('whirl'));
    await advance(page, 2);
    assert.ok(await page.evaluate(() => [...FishTank.fishes.values()].every((f) => f.state === 'whirl' || f.state === 'jump')));
    await advance(page, 8);
    assert.equal((await peek(page)).ev, null);
    assert.ok(await page.evaluate(() => [...FishTank.fishes.values()].every((f) => f.state !== 'whirl')));

    await page.evaluate(() => FishTank.startEvent('treasure'));
    await advance(page, 40);
    const p = await peek(page);
    assert.equal(p.ev, null);
    assert.match(p.banner, /搶到寶箱/);
    assert.equal(await page.evaluate(() => [...FishTank.fishes.values()].filter((f) => f.unlocked.length === 1).length), 1);
  });

  test('接上 Twitch 聊天室（模擬）：一般訊息、訂閱、小奇點、忠誠點品項、揪團', async (t) => {
    const page = await open(t, '&channel=yy2401&rw=rid-1:shark', { twitch: true });
    await page.waitForFunction(() => window.__twitch.sockets.length && window.__twitch.sockets[0].sent.includes('JOIN #yy2401'));
    const say = (line) => page.evaluate((l) => window.__twitch.say(l), line);

    await say('@display-name=小魚;badges= :fan01!fan01@fan01.tmi.twitch.tv PRIVMSG #yy2401 :大家好');
    assert.equal((await fish(page, 'fan01')).say, '大家好');

    await say('@msg-id=sub;login=fan01;display-name=小魚 :tmi.twitch.tv USERNOTICE #yy2401');
    const subbed = await fish(page, 'fan01');
    assert.equal(subbed.unlocked.length, 1);
    assert.equal(subbed.species, subbed.unlocked[0]);

    await say('@bits=100;display-name=金主 :rich!rich@rich.tmi.twitch.tv PRIVMSG #yy2401 :Cheer100 錦鯉');
    assert.equal((await fish(page, 'rich')).species, 'koi');

    await say('@custom-reward-id=rid-1;display-name=路人 :p1!p1@p1.tmi.twitch.tv PRIVMSG #yy2401 :來吧鯊魚');
    assert.equal((await peek(page)).ev, 'shark');

    await say('@msg-id=raid;login=friend;msg-param-login=friend;msg-param-displayName=好朋友;msg-param-viewerCount=30 :tmi.twitch.tv USERNOTICE #yy2401');
    assert.ok((await peek(page)).schools > 0, '揪團要有魚群');
    assert.equal((await fish(page, 'friend')).species, 'whale');
    assert.deepEqual(page.errors, []);
  });

  test('水族箱範圍：魚不會游出範圍，範圍外透明', async (t) => {
    const page = await open(t, '&top=0.5&bottom=0.05&left=0.5&right=0.05');
    await many(page, 20);
    await page.evaluate(() => FishTank.startEvent('shark'));
    for (let i = 0; i < 6; i++) {
      await advance(page, 5);
      const { area } = await peek(page);
      const out = await page.evaluate((a) => [...FishTank.fishes.values()].filter((f) => f.state !== 'jump' && f.state !== 'enter' && (f.x < a.X0 || f.x > a.X1 || f.y < a.Y0 || f.y > a.Y1)).map((f) => f.login), area);
      assert.deepEqual(out, [], '這些魚跑出範圍了');
    }
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  });

  test('魚很多時名字和泡泡不重疊，泡泡最多 8 個', async (t) => {
    const page = await open(t);
    await many(page, 40);
    await advance(page, 4);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) FishTank.handleChat({ login: 'v' + i, display: 'v' + i, text: '第 ' + i + ' 句話', badges: {} }); });
    await advance(page, 0.2);
    const placed = (await peek(page)).placed;
    assert.ok(placed.length > 10);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        assert.ok(!overlap, `第 ${i} 和第 ${j} 個標籤重疊`);
      }
    }
    assert.ok(placed.filter((p) => p.kind === 'say').length <= 8);
  });

  test('魚太多時最久沒講話的先離開；太久沒講話會自己游走', async (t) => {
    const page = await open(t, '&max=5&idle=1');
    await many(page, 5);
    await advance(page, 1);
    await chat(page, 'late', '!魚');
    assert.equal((await fish(page, 'v0')).leaving, true);
    assert.equal((await fish(page, 'late')).leaving, false);
    await advance(page, 65);
    assert.equal(await page.evaluate(() => [...FishTank.fishes.values()].filter((f) => !f.leaving).length), 0);
  });

  test('Google 試算表同步（模擬）：開頭讀進外觀，改了會寫回', async (t) => {
    const saves = [];
    const sheet = (body) => {
      if (body.key !== 'k1') return { ok: false, error: '暗號不對' };
      if (body.action === 'list') return { ok: true, profiles: { amy: { display: 'Amy', species: 'koi', color: null, size: 1.5, unlocked: ['koi'] } } };
      saves.push(...body.profiles);
      return { ok: true };
    };
    const page = await open(t, '&store=https://script.google.com/macros/s/TEST/exec&skey=k1', { sheet });
    await page.waitForFunction(() => /試算表讀到/.test(document.getElementById('status').textContent));
    await chat(page, 'amy', '嗨');
    const f = await fish(page, 'amy');
    assert.equal(f.species, 'koi');
    assert.equal(f.size, 1.5);
    await chat(page, 'amy', '!顏色 紅');
    await H.sleep(5600); // 每 5 秒寫一次
    const saved = saves.find((p) => p.login === 'amy');
    assert.ok(saved, '要寫回試算表');
    assert.equal(saved.color, '#ff4a4a');
    assert.deepEqual(saved.unlocked, ['koi']);
  });

  test('餵食：!餵 只給自己、!餵 @名字 給那個人、!餵 大家 全場都能吃', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await chat(page, 'bob', '!魚');
    await advance(page, 3);

    await chat(page, 'amy', '!餵');
    assert.ok((await peek(page)).foodOwners.every((o) => o === 'amy'), '!餵 的飼料只屬於自己');
    await advance(page, 30);
    assert.ok((await fish(page, 'amy')).size > 1, 'amy 吃到自己的飼料');
    assert.equal((await fish(page, 'bob')).size, 1, 'bob 不能吃 amy 自己的飼料');

    await advance(page, 16); // 冷卻
    await chat(page, 'amy', '!餵 @bob');
    assert.ok((await peek(page)).foodOwners.every((o) => o === 'bob'));
    await advance(page, 30);
    assert.ok((await fish(page, 'bob')).size > 1, 'bob 吃到 amy 請的飼料');

    await chat(page, 'bob', '!餵 大家');
    assert.ok((await peek(page)).foodOwners.every((o) => o === '*'));
    await chat(page, 'carl', '!魚');
    await advance(page, 16);
    await chat(page, 'carl', '!餵 @nobody');
    assert.match((await fish(page, 'carl')).say, /找不到/);
  });

  test('頭像：!頭像 表情符號、!頭像 大頭貼、!頭像 關，重新整理後還記得', async (t) => {
    const routes = {
      'https://static-cdn.jtvnw.net/': {},
      'https://decapi.me/twitch/avatar/': { contentType: 'text/plain', body: 'https://static-cdn.jtvnw.net/jtv_user_pictures/amy-profile_image-300x300.png' },
    };
    const page = await open(t, '', { routes });
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!頭像 Kappa', { tags: { emotes: '25:4-8' } });
    let f = await fish(page, 'amy');
    assert.equal(f.avatar.kind, 'emote');
    assert.equal(f.avatar.url, 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0');

    await advance(page, 6);
    await chat(page, 'amy', '!頭像 大頭貼');
    await page.waitForFunction(() => FishTank.fishes.get('amy').avatar.kind === 'pfp');
    f = await fish(page, 'amy');
    assert.match(f.avatar.url, /amy-profile_image/);
    await advance(page, 1);
    assert.deepEqual(page.errors, []);

    await H.sleep(800); // 寫進瀏覽器
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await chat(page, 'amy', '我回來了');
    assert.match((await fish(page, 'amy')).avatar.url, /amy-profile_image/);

    await chat(page, 'amy', '!頭像 關');
    assert.equal((await fish(page, 'amy')).avatar, null);
    await chat(page, 'amy', '!頭像 http://evil.example/x.png');
    assert.equal((await fish(page, 'amy')).avatar, null, '不能貼任意圖片網址');
  });

  test('頭像：實況主關掉大頭貼時會提示改用表情符號', async (t) => {
    const page = await open(t, '&pfp=0', { routes: { 'https://decapi.me/': { contentType: 'text/plain', body: 'https://static-cdn.jtvnw.net/x.png' } } });
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!頭像 大頭貼');
    assert.match((await fish(page, 'amy')).say, /沒有開放大頭貼/);
    assert.equal(page.requested, undefined, '關掉時不要去查大頭貼');
  });

  test('自訂魚種：!名字 或 !變 名字 變成實況主上傳的圖，說明卡也看得到', async (t) => {
    const skin = encodeURIComponent('小雞|https://img.example.com/chick.png');
    const page = await open(t, `&skin=${skin}`, { routes: { 'https://img.example.com/': {} } });
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!小雞');
    assert.equal((await fish(page, 'amy')).species, 'c:小雞');
    await chat(page, 'bob', '!魚');
    await chat(page, 'bob', '!變 小雞');
    assert.equal((await fish(page, 'bob')).species, 'c:小雞');
    await advance(page, 3);
    await H.sleep(500); // 圖片是非同步載入
    assert.ok((page.requested || []).some((u) => u.includes('chick.png')), '要載入自訂魚種的圖');
    assert.ok(await page.evaluate(() => [...document.images].length === 0), '圖只畫在 Canvas 上');
    assert.match(await page.$eval('#help dl', (e) => e.textContent), /!小雞/);
    await chat(page, 'carl', '!變 不存在');
    assert.match((await fish(page, 'carl')).say, /小雞/, '可以變的清單要列出自訂魚種');
    assert.deepEqual(page.errors, []);
  });

  test('魚缸外觀：配色主題與自訂顏色畫出來的海水顏色對、元素可以關掉', async (t) => {
    const waterAt = (page) => page.evaluate(() => {
      const { area } = FishTank.peek();
      const c = document.getElementById('tank');
      const k = c.width / innerWidth;
      const y = Math.round(((area.surfaceY + area.floorY) / 2) * k);
      return [...c.getContext('2d').getImageData(Math.round(30 * k), y, 1, 1).data].slice(0, 3);
    });
    const near = (a, hex, tol = 40) => {
      const n = parseInt(hex.slice(1), 16);
      return Math.abs(a[0] - (n >> 16)) + Math.abs(a[1] - ((n >> 8) & 255)) + Math.abs(a[2] - (n & 255)) < tol * 3;
    };
    let page = await open(t, '&hide=rays,bubbles,surface,rocks,sand&weed=0&deco=');
    await advance(page, 0.1);
    assert.ok(near(await waterAt(page), '#0f5582'), '預設是海洋的藍色');
    assert.equal((await peek(page)).seaweed, 0, 'weed=0 沒有海草');

    page = await open(t, '&theme=sunset&hide=rays,bubbles&weed=0&deco=');
    await advance(page, 0.1);
    const sunset = await waterAt(page);
    assert.ok(near(sunset, '#c45a8a', 60), `夕陽主題的海水要偏紫紅，實際 ${sunset}`);

    page = await open(t, '&water=%23ff0000,%23ff0000&hide=rays,bubbles&weed=3&deco=');
    await advance(page, 0.1);
    assert.ok(near(await waterAt(page), '#ff0000'), '自訂顏色');
    assert.ok((await peek(page)).seaweed > 20, 'weed=3 海草很多');
  });

  test('觀眾打扮：!戴 配件、!花紋，可以拿掉，重新整理後還記得', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!戴 皇冠');
    await chat(page, 'amy', '!花紋 星星');
    let f = await page.evaluate(() => { const f = FishTank.fishes.get('amy'); return { wear: f.wear, pattern: f.pattern }; });
    assert.deepEqual(f, { wear: 'crown', pattern: 'stars' });
    await advance(page, 4);
    await chat(page, 'amy', '!戴 不存在的東西');
    assert.match((await fish(page, 'amy')).say, /皇冠/);
    for (const w of ['帽子', '眼鏡', '蝴蝶結', '海盜帽', '花', '耳機', '光環']) { await advance(page, 4); await chat(page, 'amy', '!戴 ' + w); await advance(page, 0.1); }
    for (const w of ['條紋', '斑點', '愛心']) { await advance(page, 4); await chat(page, 'amy', '!花紋 ' + w); await advance(page, 0.1); }
    assert.deepEqual(page.errors, [], '每種配件、花紋都畫得出來');
    await H.sleep(800);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await chat(page, 'amy', '我回來了');
    f = await page.evaluate(() => { const f = FishTank.fishes.get('amy'); return { wear: f.wear, pattern: f.pattern }; });
    assert.deepEqual(f, { wear: 'halo', pattern: 'hearts' });
    await chat(page, 'amy', '!戴 關');
    assert.equal(await page.evaluate(() => FishTank.fishes.get('amy').wear), null);
  });

  test('觀眾提交自己的魚：要管理員 !tank ok 才出現，!tank no 退回，一般觀眾不能核准', async (t) => {
    const page = await open(t, '', { routes: { 'https://img.example.com/': {} } });
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!我的魚 https://img.example.com/amy.png');
    assert.deepEqual((await peek(page)).pending, ['amy']);
    assert.notEqual((await fish(page, 'amy')).species, 'u:amy', '還沒核准不能出現');
    await chat(page, 'bob', '!tank ok @amy'); // 一般觀眾
    assert.deepEqual((await peek(page)).pending, ['amy']);
    await chat(page, 'mod1', '!tank ok @amy', { badges: { mod: true } });
    assert.deepEqual((await peek(page)).pending, []);
    assert.equal((await fish(page, 'amy')).species, 'u:amy');
    await chat(page, 'carl', '!變 u:amy');
    assert.notEqual((await fish(page, 'carl')).species, 'u:amy', '別人不能用 amy 的魚');

    await chat(page, 'dan', '!魚');
    await chat(page, 'dan', '!我的魚 https://img.example.com/bad.png');
    await chat(page, 'boss', '!tank no @dan', { badges: { broadcaster: true } });
    assert.deepEqual((await peek(page)).pending, []);
    assert.match((await fish(page, 'dan')).say, /沒有通過/);

    await H.sleep(800);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await chat(page, 'amy', '我回來了');
    assert.equal((await fish(page, 'amy')).species, 'u:amy', '核准過的魚重新整理後還在');
    await chat(page, 'amy', '!我的魚 關');
    assert.notEqual((await fish(page, 'amy')).species, 'u:amy');
  });

  test('實況主關掉提交時，!我的魚 會說明沒開放', async (t) => {
    const page = await open(t, '&submit=0');
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!我的魚 https://img.example.com/amy.png');
    assert.deepEqual((await peek(page)).pending, []);
    assert.match((await fish(page, 'amy')).say, /沒有開放/);
  });

  test('魚缸物件：網址裡的物件都畫得出來，舊網址的 deco 也還能用', async (t) => {
    const all = C.OBJECT_IDS.map((t, i) => `${t}~${(i + 0.5) / 12}~~1~${i % 2}~`).join('|') + '|anchor~0.5~0.4~2~0~ff0000';
    let page = await open(t, '&objs=' + encodeURIComponent(all));
    await advance(page, 0.2);
    assert.equal(await page.evaluate(() => FishTank.objects.length), 13);
    assert.deepEqual(page.errors, []);
    page = await open(t, '&deco=castle,ship');
    assert.deepEqual(await page.evaluate(() => FishTank.objects.map((o) => o.t)), ['castle']);
    page = await open(t, '&objs=');
    assert.equal(await page.evaluate(() => FishTank.objects.length), 0);
  });

  test('觀眾自訂：副色、配件色、大小、名牌、表情，重新整理後還記得', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    const L0 = await page.evaluate(() => FishTank.fishes.get('amy').size);
    for (const cmd of ['!副色 藍', '!戴 皇冠', '!配件色 粉', '!大小 大', '!名牌 #ff66aa', '!表情 愛心眼']) { await chat(page, 'amy', cmd); await advance(page, 6); }
    const look = () => page.evaluate(() => { const f = FishTank.fishes.get('amy'); return { color2: f.color2, wearColor: f.wearColor, sizePick: f.sizePick, tag: f.tag, face: f.expr }; });
    assert.deepEqual(await look(), { color2: '#3fa4ff', wearColor: '#ff8ccf', sizePick: 'large', tag: '#ff66aa', face: 'love' });
    assert.equal(L0, 1);
    for (const face of ['開心', '生氣', '想睡', '驚訝', '星星眼', '眨眼', '暈']) { await chat(page, 'amy', '!表情 ' + face); await advance(page, 3.5); }
    for (const sp of ['!鯊魚', '!水母', '!河豚']) { await chat(page, 'amy', sp); await advance(page, 6); }
    assert.deepEqual(page.errors, [], '每種表情、每種魚都畫得出來');
    await chat(page, 'amy', '!名牌 隱藏');
    await advance(page, 0.2);
    const names = await page.evaluate(() => FishTank.peek().placed.length);
    assert.equal(names, 0, '名牌藏起來就不畫名字');
    await H.sleep(800);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await chat(page, 'amy', '我回來了');
    assert.deepEqual(await look(), { color2: '#3fa4ff', wearColor: '#ff8ccf', sizePick: 'large', tag: 'hide', face: 'dizzy' });
    await chat(page, 'amy', '!副色 關');
    assert.equal(await page.evaluate(() => FishTank.fishes.get('amy').color2), null);
  });
}
