/* 水族箱畫面：讀聊天室 → 每位觀眾一隻魚，Canvas 模擬與繪製 */
(function () {
  const C = FishCore;
  const opt = C.readOptions(location.search);
  const canvas = document.getElementById('tank');
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MAX_BUBBLES = 8; // 同時最多幾個對話泡泡

  let W = 0, H = 0, DPR = 1, S = 1;
  let surfaceY = 0, floorY = 0;
  let X0 = 0, X1 = 0, Y0 = 0, Y1 = 0, TW = 0; // 水族箱範圍（像素）
  let DS = 1; // 裝飾的縮放
  let boxed = false; // 不是全畫面時，完整背景模式畫成玻璃魚缸
  const rx = (a, b) => X0 + TW * rand(a, b); // 水族箱寬度的幾成到幾成之間
  let bgLayer = null, decoLayer = null;
  let seaweed = [];
  let emitters = []; // 裝飾的冒泡點：{ x, y, kind }
  const fishes = new Map(); // login → fish
  const food = [];
  const parts = []; // 粒子：泡泡、水花、愛心、zzz
  const cool = {};
  let now = performance.now();
  const SKIN = Object.fromEntries(opt.skins.map((k) => [k.id, { name: k.name, url: k.url, color: '#ffffff', scale: 1.15, speed: 50, custom: true }]));
  // 觀眾提交、管理員核准過的個人魚（魚種 ID 是 u:帳號，只有本人能用）
  function registerMine(login, display, url) {
    SKIN['u:' + login] = { name: `${display || login} 的魚`, url, color: '#ffffff', scale: 1.15, speed: 50, custom: true, owner: login };
  }
  const pending = new Map(); // 等待核准的提交：帳號 → { url, display }
  let frameDt = 0.016;

  // ───────── 觀眾外觀：瀏覽器先記一份，有設定試算表就同步到雲端 ─────────
  const STORE = 'fishtank.profiles.v1';
  let profiles = {};
  try { profiles = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { profiles = {}; }
  let saveTimer = 0;
  const dirty = new Set(); // 還沒寫進試算表的帳號
  function saveProfile(f) {
    profiles[f.login] = { display: f.display, species: f.species, color: f.color, size: +f.size.toFixed(2), unlocked: f.unlocked.slice(), avatar: f.avatar, wear: f.wear, pattern: f.pattern, mine: f.mine };
    dirty.add(f.login);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(profiles)); } catch { /* 無痕或封鎖儲存：只是不記外觀 */ } }, 500);
  }
  function applyProfile(f, p) {
    f.mine = /^https:\/\//.test(p.mine || '') ? p.mine : null;
    if (f.mine) registerMine(f.login, p.display || f.display, f.mine);
    if (C.SPECIES[p.species] || SKIN[p.species]) f.species = p.species;
    f.wear = C.WEARS[p.wear] ? p.wear : null;
    f.pattern = C.PATTERNS[p.pattern] ? p.pattern : null;
    f.color = p.color || null;
    f.size = clamp(+p.size || 1, 0.6, 2);
    f.unlocked = Array.isArray(p.unlocked) ? p.unlocked.filter((id) => C.SPECIES[id]) : [];
    f.avatar = p.avatar && /^https:\/\//.test(p.avatar.url || '') ? { kind: p.avatar.kind, url: p.avatar.url } : null;
  }

  async function cloudCall(body) {
    const r = await fetch(opt.store, { method: 'POST', body: JSON.stringify({ key: opt.skey, ...body }) }); // 純文字內容，不會觸發 CORS 預檢
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '試算表回應錯誤');
    return j;
  }
  async function cloudLoad() {
    try {
      const j = await cloudCall({ action: 'list' });
      let n = 0;
      for (const [login, p] of Object.entries(j.profiles || {})) {
        if (dirty.has(login)) continue; // 剛改過的以這台為準
        profiles[login] = { ...profiles[login], ...p };
        const f = fishes.get(login);
        if (f) applyProfile(f, profiles[login]);
        n++;
      }
      try { localStorage.setItem(STORE, JSON.stringify(profiles)); } catch { /* 同上 */ }
      status(`☁️ 從試算表讀到 ${n} 隻魚的外觀`);
    } catch (e) {
      status('☁️ 試算表連不上，先用這台記的外觀：' + (e.message === 'Failed to fetch' ? '請到設定頁按「測試連線」檢查' : e.message), true);
    }
  }
  async function cloudFlush() {
    if (!dirty.size) return;
    const list = [...dirty].map((login) => ({ login, ...profiles[login] }));
    dirty.clear();
    try {
      await cloudCall({ action: 'save', profiles: list });
    } catch {
      for (const p of list) dirty.add(p.login); // 下次再送
    }
  }

  // ───────── 畫面大小與背景 ─────────
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    S = clamp(Math.min(W / 1280, H / 720), 0.45, 2.5);
    const tank = opt.bg === 'tank';
    X0 = W * opt.left;
    X1 = W * (1 - opt.right);
    Y0 = H * opt.top;
    Y1 = H * (1 - opt.bottom);
    TW = X1 - X0;
    boxed = tank && (opt.top || opt.bottom || opt.left || opt.right) > 0;
    surfaceY = Y0 + (tank ? Math.max((Y1 - Y0) * 0.07, 18 * S) : 12 * S);
    floorY = Y1 - (tank ? 46 * S : 16 * S);
    document.documentElement.classList.toggle('transparent', !tank || boxed);
    placeOverlays();
    buildBackground();
    buildDecorations();
  }

  // 說明卡、橫幅、提示、狀態跟著水族箱範圍走
  function placeOverlays() {
    const set = (id, css) => Object.assign(document.getElementById(id).style, css);
    set('tip', { left: X0 + 12 + 'px', bottom: H - Y1 + 12 + 'px' });
    set('status', { right: W - X1 + 12 + 'px', top: Y0 + 12 + 'px' });
    set('banner', { left: X0 + TW / 2 + 'px', top: Y0 + (Y1 - Y0) * 0.09 + 'px', maxWidth: TW * 0.9 + 'px' });
    set('help', { left: X0 + TW / 2 + 'px', top: (Y0 + Y1) / 2 + 'px' });
  }

  function boxPath(b) {
    b.beginPath();
    b.roundRect(X0, Y0, TW, Y1 - Y0, boxed ? 16 * S : 0);
  }

  function layer() {
    const c = document.createElement('canvas');
    c.width = W * DPR;
    c.height = H * DPR;
    const b = c.getContext('2d');
    b.scale(DPR, DPR);
    return [c, b];
  }

  function buildBackground() {
    seaweed = [];
    if (opt.bg !== 'tank') { bgLayer = null; return; }
    const [c, b] = layer();
    bgLayer = c;
    const th = opt.theme;
    b.save();
    boxPath(b);
    b.clip();
    // 背景圖片：蓋滿整個魚缸（圖還沒載好就先畫配色，載好再重畫一次）
    const bgim = opt.bgimg && image(opt.bgimg);
    if (opt.bgimg && !bgim) images.get(opt.bgimg).addEventListener('load', buildBackground, { once: true });
    if (bgim) {
      const k = Math.max(TW / bgim.naturalWidth, (Y1 - Y0) / bgim.naturalHeight);
      const w = bgim.naturalWidth * k, h = bgim.naturalHeight * k;
      b.drawImage(bgim, X0 + (TW - w) / 2, Y0 + (Y1 - Y0 - h) / 2, w, h);
    } else {
      // 水面上方（空氣）；玻璃魚缸時淡一點，看得到後面的遊戲畫面
      const air = b.createLinearGradient(0, Y0, 0, surfaceY);
      air.addColorStop(0, th.air[0]);
      air.addColorStop(1, th.air[1]);
      b.globalAlpha = boxed ? 0.5 : 1;
      b.fillStyle = air;
      b.fillRect(X0, Y0, TW, surfaceY - Y0);
      b.globalAlpha = 1;
      // 水
      const water = b.createLinearGradient(0, surfaceY, 0, Y1);
      water.addColorStop(0, th.water[0]);
      water.addColorStop(0.45, th.water[1]);
      water.addColorStop(1, th.water[2]);
      b.fillStyle = water;
      b.fillRect(X0, surfaceY, TW, Y1 - surfaceY);
    }
    if (!opt.hide.includes('sand')) drawSand(b, th);
    if (!opt.hide.includes('rocks')) drawRocks(b, th);
    b.restore();
    if (boxed) drawGlass(b);
    // 海草（會擺動，所以只記位置，每幀畫）；不比水深高。多寡：0 沒有、1 一般、2 多、3 很多
    const n = opt.weed ? Math.max(2, Math.round((TW / 110) * [0, 1, 1.8, 2.8][opt.weed])) : 0;
    const maxH = (floorY - surfaceY) * 0.8;
    for (let i = 0; i < n; i++) {
      seaweed.push({
        x: rx(0.02, 0.98), h: Math.min(maxH, rand(70, 190) * S), seg: 7, ph: rand(0, TAU),
        color: th.weed[Math.random() < 0.7 ? Math.floor(Math.random() * 2) : 2],
        w: rand(5, 9) * S,
      });
    }
  }

  function drawSand(b, th) {
    b.beginPath();
    b.moveTo(X0, Y1);
    for (let x = X0; x <= X1 + 20; x += 20) b.lineTo(x, floorY + 6 * S + Math.sin(x * 0.012) * 7 * S + Math.sin(x * 0.031) * 3 * S);
    b.lineTo(X1, Y1);
    b.closePath();
    const sand = b.createLinearGradient(0, floorY - 10 * S, 0, Y1);
    sand.addColorStop(0, th.sand[0]);
    sand.addColorStop(1, th.sand[1]);
    b.fillStyle = sand;
    b.fill();
    // 沙上的小石頭與貝殼點點
    for (let i = 0; i < TW / 9; i++) {
      b.fillStyle = `rgba(${Math.random() < 0.5 ? '90,70,40' : '250,235,200'},${rand(0.25, 0.6)})`;
      b.beginPath();
      b.arc(rx(0, 1), rand(floorY + 12 * S, Y1), rand(0.8, 2.4) * S, 0, TAU);
      b.fill();
    }
  }

  function drawRocks(b, th) {
    const rocks = Math.max(1, Math.round(TW / 420));
    for (let i = 0; i < rocks; i++) {
      const x = X0 + (i + 0.5) * (TW / rocks) + rand(-80, 80) * S;
      const rw = rand(50, 90) * S, rh = rand(30, 55) * S;
      const g = b.createLinearGradient(x, floorY - rh, x, floorY + 10 * S);
      g.addColorStop(0, th.rock[0]);
      g.addColorStop(1, th.rock[1]);
      b.fillStyle = g;
      b.beginPath();
      b.ellipse(x, floorY + 6 * S, rw, rh, 0, Math.PI, 0);
      b.fill();
    }
  }

  // 玻璃魚缸外框：邊框、上緣、左邊的反光
  function drawGlass(b) {
    const r = 16 * S;
    b.save();
    boxPath(b);
    b.lineWidth = 6 * S;
    b.strokeStyle = 'rgba(200,235,255,0.55)';
    b.stroke();
    b.lineWidth = 2 * S;
    b.strokeStyle = 'rgba(255,255,255,0.35)';
    b.beginPath();
    b.roundRect(X0 + 5 * S, Y0 + 5 * S, TW - 10 * S, Y1 - Y0 - 10 * S, r * 0.7);
    b.stroke();
    const shine = b.createLinearGradient(X0, 0, X0 + 40 * S, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.18)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    b.fillStyle = shine;
    b.fillRect(X0 + 10 * S, Y0 + r, 40 * S, Y1 - Y0 - 2 * r);
    b.fillStyle = '#23323f';
    b.beginPath();
    b.roundRect(X0 - 6 * S, Y0 - 8 * S, TW + 12 * S, 12 * S, 5 * S);
    b.fill();
    b.restore();
  }

  // ───────── 魚缸裝飾（城堡、寶箱、珊瑚、打氣石），透明模式也畫在底部 ─────────
  function buildDecorations() {
    emitters = [];
    decoLayer = null;
    if (!opt.deco.length) return;
    const [c, b] = layer();
    decoLayer = c;
    const n = opt.deco.length;
    DS = S * clamp((floorY - surfaceY) / (420 * S), 0.4, 1); // 魚缸矮的時候裝飾跟著縮小
    const base = floorY + 8 * S;
    opt.deco.forEach((d, i) => {
      // 平均分散在底部，避開正中間（魚最常經過）
      const x = X0 + TW * ((i + 0.5) / n) * 0.84 + TW * 0.08 + rand(-30, 30) * S;
      ({ castle: drawCastle, chest: drawChestDeco, coral: drawCoral, bubbler: drawBubbler })[d](b, x, base);
    });
  }

  function drawCastle(b, x, base) {
    const s = DS * 1.1;
    const stone = b.createLinearGradient(0, base - 150 * s, 0, base);
    stone.addColorStop(0, '#a99cc0');
    stone.addColorStop(1, '#5d5470');
    b.fillStyle = stone;
    const tower = (tx, w, h) => {
      b.fillRect(tx - w / 2, base - h, w, h);
      for (let k = 0; k < 3; k++) b.fillRect(tx - w / 2 + k * (w / 2.5), base - h - 8 * s, w / 5, 8 * s);
    };
    tower(x, 90 * s, 80 * s);
    tower(x - 52 * s, 36 * s, 130 * s);
    tower(x + 52 * s, 36 * s, 130 * s);
    b.fillStyle = '#c4507a';
    for (const tx of [x - 52 * s, x + 52 * s]) {
      b.beginPath();
      b.moveTo(tx - 22 * s, base - 136 * s);
      b.lineTo(tx, base - 175 * s);
      b.lineTo(tx + 22 * s, base - 136 * s);
      b.fill();
    }
    b.fillStyle = '#1c1830';
    b.beginPath();
    b.moveTo(x - 16 * s, base);
    b.lineTo(x - 16 * s, base - 30 * s);
    b.arc(x, base - 30 * s, 16 * s, Math.PI, 0);
    b.lineTo(x + 16 * s, base);
    b.fill();
    for (const [wx, wy] of [[-52, 100], [52, 100], [-52, 65], [52, 65]]) {
      b.beginPath();
      b.roundRect(x + wx * s - 5 * s, base - wy * s, 10 * s, 16 * s, [5 * s, 5 * s, 0, 0]);
      b.fill();
    }
    emitters.push({ x, y: base - 30 * s, kind: 'door' });
  }

  function drawChestDeco(b, x, base) {
    const s = DS * 1.2;
    const w = 70 * s, h = 34 * s;
    // 打開的蓋子
    b.fillStyle = '#7a4a22';
    b.beginPath();
    b.moveTo(x - w / 2, base - h);
    b.lineTo(x - w / 2 + 6 * s, base - h - 34 * s);
    b.lineTo(x + w / 2 + 6 * s, base - h - 34 * s);
    b.lineTo(x + w / 2, base - h);
    b.fill();
    // 金幣
    b.fillStyle = '#ffd23f';
    for (let i = 0; i < 9; i++) {
      b.beginPath();
      b.arc(x - w / 2 + 10 * s + i * 6.5 * s, base - h - 2 * s - Math.sin(i * 1.3) * 4 * s, 6 * s, 0, TAU);
      b.fill();
    }
    b.fillStyle = '#a8662e';
    b.fillRect(x - w / 2, base - h, w, h);
    b.fillStyle = '#d6a43a';
    b.fillRect(x - w / 2, base - h, w, 5 * s);
    b.fillRect(x - 6 * s, base - h, 12 * s, 16 * s);
    b.fillRect(x - w / 2 + 8 * s, base - h, 5 * s, h);
    b.fillRect(x + w / 2 - 13 * s, base - h, 5 * s, h);
    emitters.push({ x, y: base - h - 6 * s, kind: 'chest' });
  }

  function drawCoral(b, x, base) {
    const branch = (bx, by, ang, len, w, color, depth) => {
      const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
      b.strokeStyle = color;
      b.lineWidth = w;
      b.lineCap = 'round';
      b.beginPath();
      b.moveTo(bx, by);
      b.lineTo(ex, ey);
      b.stroke();
      if (depth > 0) {
        branch(ex, ey, ang - rand(0.25, 0.6), len * 0.75, w * 0.72, color, depth - 1);
        branch(ex, ey, ang + rand(0.25, 0.6), len * 0.75, w * 0.72, color, depth - 1);
      }
    };
    branch(x - 18 * DS, base, -Math.PI / 2 - 0.15, 42 * DS, 10 * DS, '#ff7a9a', 3);
    branch(x + 22 * DS, base, -Math.PI / 2 + 0.2, 32 * DS, 8 * DS, '#ff9a4a', 3);
    b.fillStyle = '#ffb3c6';
    for (let i = 0; i < 6; i++) {
      b.beginPath();
      b.arc(x + rand(-50, 50) * DS, base - rand(0, 6) * DS, rand(3, 6) * DS, 0, TAU);
      b.fill();
    }
  }

  function drawBubbler(b, x, base) {
    b.fillStyle = '#5f6b75';
    b.beginPath();
    b.ellipse(x, base - 4 * DS, 16 * DS, 9 * DS, 0, 0, TAU);
    b.fill();
    b.fillStyle = 'rgba(255,255,255,0.25)';
    b.beginPath();
    b.ellipse(x - 4 * DS, base - 8 * DS, 6 * DS, 3 * DS, 0, 0, TAU);
    b.fill();
    emitters.push({ x, y: base - 10 * DS, kind: 'bubbler' });
  }

  // ───────── 顏色小工具 ─────────
  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) { // amt > 0 變亮、< 0 變暗
    const [r, g, bl] = hexRgb(hex);
    const t = amt < 0 ? 0 : 255, a = Math.abs(amt);
    return `rgb(${Math.round(r + (t - r) * a)},${Math.round(g + (t - g) * a)},${Math.round(bl + (t - bl) * a)})`;
  }
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function colorOf(f) {
    if (f.color === 'rainbow') return hslHex((now / 20 + f.hue) % 360, 85, 60);
    return f.color || spec(f.species).color;
  }

  // 魚種資料：內建魚種，或實況主在設定頁加的自訂魚種（一張圖）
  function spec(id) { return C.SPECIES[id] || SKIN[id] || C.SPECIES.goldfish; }
  // 「鯊魚」「shark」「小雞」（自訂）→ 魚種 ID
  function findSkin(word) {
    const w = String(word || '').trim().toLowerCase();
    const k = opt.skins.find((s) => s.id.toLowerCase() === w || s.name.toLowerCase() === w);
    return k ? k.id : C.findSpecies(word);
  }

  // 圖片（自訂魚種、表情符號、大頭貼）載入一次就留著；還沒載好時先不畫
  const images = new Map();
  function image(url) {
    let im = images.get(url);
    if (!im) {
      im = new Image();
      im.src = url;
      images.set(url, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  // ───────── 魚 ─────────
  function bodyLen(f) { return 44 * S * opt.scale * spec(f.species).scale * f.size; }
  // 魚身往上、往下各佔幾倍身長（放名字和泡泡用）
  const TOP = { goldfish: 0.36, clown: 0.32, puffer: 0.32, angel: 0.72, shark: 0.36, jelly: 0.38, whale: 0.24, narwhal: 0.22, koi: 0.24 };
  const BOTTOM = { goldfish: 0.28, clown: 0.26, puffer: 0.3, angel: 0.72, shark: 0.28, jelly: 0.72, whale: 0.22, narwhal: 0.18, koi: 0.2 };
  function extent(f, table) {
    let k = table[f.species];
    if (k === undefined) { // 自訂魚種：看圖片的長寬比
      const im = image(spec(f.species).url);
      k = im ? (im.naturalHeight / im.naturalWidth) * 0.5 : 0.35;
    }
    const v = k * bodyLen(f);
    return f.species === 'puffer' ? v * (1 + f.puff * 0.55) : v;
  }

  function canUse(f, id) {
    return !spec(id).rare || f.unlocked.includes(id) || f.badges.broadcaster;
  }

  function spawn(msg) {
    // 滿了就請最久沒講話的魚離開
    const active = [...fishes.values()].filter((f) => !f.leaving);
    if (active.length >= opt.max) active.sort((a, b) => a.last - b.last)[0].leaving = true;
    const f = {
      login: msg.login,
      display: msg.display || msg.login,
      badges: msg.badges || {},
      species: C.defaultSpecies(msg.login),
      color: null, size: 1, unlocked: [], avatar: null, wear: null, pattern: null, mine: null,
      hue: C.hashStr(msg.login) % 360,
      x: rx(0.1, 0.9),
      y: surfaceY - 30 * S,
      vx: rand(-20, 20) * S, vy: 160 * S,
      dir: Math.random() < 0.5 ? -1 : 1, face: 1,
      tx: 0, ty: 0, retarget: 0,
      tail: rand(0, TAU), pitch: 0, spin: 0, puff: 0, alpha: 0,
      state: 'enter', st: 0, other: null,
      say: '', sayT: 0, sayAt: 0, slot: 0, nameA: 1, zz: 0,
      flee: 0, fleeX: 0, fleeY: 0, spout: rand(4, 10),
      last: now, leaving: false,
    };
    if (profiles[msg.login]) applyProfile(f, profiles[msg.login]);
    f.face = f.dir;
    pickTarget(f);
    fishes.set(f.login, f);
    splash(f.x, surfaceY, 10);
    return f;
  }

  function pickTarget(f) {
    const m = Math.min(60 * S, TW * 0.25);
    f.tx = rand(X0 + m, X1 - m);
    f.ty = rand(surfaceY + 40 * S, floorY - 30 * S);
    f.retarget = rand(4, 9);
  }

  function speak(f, text, sec = 6, max = 28) {
    let t = String(text).replace(/\s+/g, ' ').trim();
    if (!t) return;
    if ([...t].length > max) t = [...t].slice(0, max - 1).join('') + '…';
    f.say = t;
    f.sayT = sec;
    f.sayAt = now;
  }

  function setState(f, state, st) {
    f.state = state;
    f.st = st;
  }

  // 解鎖稀有魚種並直接變身；全部都有了就改成變大
  function unlockRare(f, want, reason) {
    const id = C.pickRare(f.unlocked, want);
    if (!id) {
      f.size = Math.min(2, f.size + 0.2);
      poof(f);
      saveProfile(f);
      banner(`🎉 ${f.display} ${reason}，稀有魚種都收集齊了，直接變大！`);
      return;
    }
    f.unlocked.push(id);
    f.species = id;
    poof(f);
    saveProfile(f);
    banner(`🎉 ${f.display} ${reason}，解鎖稀有魚種「${C.SPECIES[id].name}」！`);
  }

  function ensureFish(msg) {
    let f = fishes.get(msg.login);
    if (f && f.leaving) { fishes.delete(f.login); f = null; }
    if (!f) f = spawn(msg);
    f.last = now;
    f.display = msg.display || f.display;
    if (msg.badges) f.badges = msg.badges;
    return f;
  }

  // ───────── 聊天訊息 → 動作 ─────────
  function handleChat(msg) {
    if (!msg.login || opt.ignore.includes(msg.login)) return;
    const badges = msg.badges || {};

    // 訂閱、送訂閱、揪團
    if (msg.notice) {
      if (msg.kind === 'sub' && opt.subs) unlockRare(ensureFish(msg), null, '訂閱了');
      if (msg.kind === 'raid') startEvent('school', msg);
      return;
    }

    const tags = msg.tags || {};
    // 忠誠點品項（只有「需要觀眾輸入文字」的品項會出現在聊天室）
    const reward = tags['custom-reward-id'] && opt.rewards[tags['custom-reward-id']];
    if (reward) {
      const f = ensureFish(msg);
      if (reward === 'rare') unlockRare(f, C.findSpecies(msg.text), '兌換了忠誠點');
      else if (reward === 'feed') tankCommand('feed');
      else startEvent(reward, msg);
      return;
    }
    // 小奇點
    if (opt.bits > 0 && +tags.bits >= opt.bits) {
      const f = ensureFish(msg);
      const want = msg.text.split(/\s+/).map(C.findSpecies).find(Boolean);
      unlockRare(f, want, `贊助了 ${tags.bits} 小奇點`);
      return;
    }

    const cmd = C.parseCommand(msg.text, opt.skins);
    if (cmd && cmd.cmd === 'tank') {
      if (badges.broadcaster || badges.mod) tankCommand(cmd.arg);
      return;
    }
    if (cmd && cmd.cmd === 'help') {
      if (C.cooldownOk(cool, '*', 'help', now)) showHelp();
      return;
    }

    let f = fishes.get(msg.login);
    if (f && f.leaving) { fishes.delete(f.login); f = null; }
    if (!f) {
      if (cmd && cmd.cmd === 'leave') return;
      if (!cmd && !opt.auto) return;
      f = spawn(msg);
      if (cmd && cmd.cmd === 'join') return;
    }
    f.last = now;
    f.display = msg.display || f.display;
    f.badges = badges;

    if (!cmd) {
      if (opt.say) speak(f, msg.text);
      return;
    }
    if (!C.cooldownOk(cool, f.login, cmd.cmd, now)) return;
    const wake = () => { if (f.state === 'sleep') setState(f, 'swim', 0); };

    switch (cmd.cmd) {
      case 'join':
        speak(f, '我在這裡！');
        break;
      case 'leave':
        f.leaving = true;
        speak(f, '掰掰～');
        break;
      case 'skin': {
        let id = findSkin(cmd.arg);
        if (['我的魚', '我的', 'mine'].includes(cmd.arg) && f.mine) id = 'u:' + f.login;
        if (!id) { speak(f, '可以變：' + skinNames().join('、'), 6, 60); break; }
        if (!canUse(f, id)) { speak(f, `${spec(id).name}是稀有魚種，${rareHint()}`, 8, 60); break; }
        f.species = id;
        poof(f);
        saveProfile(f);
        break;
      }
      case 'color': {
        const c = C.findColor(cmd.arg);
        if (!c) { speak(f, '試試 !顏色 紅／藍／粉／彩虹／#ff66aa'); break; }
        f.color = c;
        poof(f);
        saveProfile(f);
        break;
      }
      case 'jump':
        wake();
        jump(f);
        break;
      case 'dash':
        wake();
        setState(f, 'dash', 0.9);
        break;
      case 'spin':
        wake();
        setState(f, 'spin', 1.2);
        break;
      case 'sleep':
        setState(f, 'sleep', 60);
        break;
      case 'bubble':
        wake();
        if (f.species === 'puffer') f.puff = 1;
        if (f.species === 'whale' || f.species === 'narwhal') f.spout = 0;
        for (let i = 0; i < 8; i++) bubble(f.x + f.dir * bodyLen(f) * 0.45, f.y, rand(2, 6) * S, i * 0.08);
        break;
      case 'feed': {
        // !餵 只給自己、!餵 @名字 給那個人、!餵 大家 全場都能吃
        wake();
        if (cmd.target === '*') {
          for (let i = 0; i < 3; i++) dropFood(rx(0.15, 0.85), 4, null);
          speak(f, '請大家吃！');
          break;
        }
        const to = cmd.target ? fishes.get(cmd.target) : f;
        if (!to || to.leaving) { speak(f, `找不到 @${cmd.target} 的魚`); break; }
        dropFood(to.x, 5, to.login);
        if (to !== f) { speak(f, `請 ${to.display} 吃飼料`); hearts(to.x, to.y - bodyLen(to) * 0.4, 2); }
        break;
      }
      case 'avatar':
        setAvatar(f, cmd.arg, tags);
        break;
      case 'wear': {
        const id = C.findWear(cmd.arg);
        if (id === null) { speak(f, '可以戴：' + Object.values(C.WEARS).map((w) => w.name).join('、') + '（!戴 關 拿掉）', 6, 60); break; }
        f.wear = id || null;
        if (id) poof(f);
        saveProfile(f);
        break;
      }
      case 'pattern': {
        const id = C.findPattern(cmd.arg);
        if (id === null) { speak(f, '花紋有：' + Object.values(C.PATTERNS).map((w) => w.name).join('、') + '（!花紋 關 拿掉）', 6, 60); break; }
        f.pattern = id || null;
        if (id) poof(f);
        saveProfile(f);
        break;
      }
      case 'mine':
        submitMine(f, cmd.arg);
        break;
      case 'follow':
      case 'hug': {
        const other = cmd.target && fishes.get(cmd.target);
        if (!other || other === f) { speak(f, cmd.target ? `找不到 @${cmd.target} 的魚` : `要指定對象：!${cmd.cmd === 'hug' ? '抱' : '跟'} @名字`); break; }
        wake();
        setState(f, cmd.cmd, cmd.cmd === 'hug' ? 12 : 30);
        f.other = other.login;
        break;
      }
    }
  }

  // !我的魚 圖片網址：先放進待核准清單，管理員 !tank ok @名字 才會顯示；!我的魚 關 換回一般魚
  function submitMine(f, arg) {
    const url = String(arg || '').trim();
    if (['關', '關掉', '取消', 'off', '不要'].includes(url)) {
      if (SKIN[f.species] && SKIN[f.species].owner) f.species = C.defaultSpecies(f.login);
      f.mine = null;
      saveProfile(f);
      return;
    }
    if (!opt.submit) { speak(f, '這個頻道沒有開放自己提交魚的圖片', 6, 40); return; }
    if (!/^https:\/\/\S+$/.test(url)) { speak(f, '用法：!我的魚 圖片網址（https:// 開頭），管理員核准後才會出現', 8, 60); return; }
    if (pending.size >= 30 && !pending.has(f.login)) pending.delete(pending.keys().next().value);
    pending.set(f.login, { url, display: f.display });
    speak(f, '收到！等管理員核准（!tank ok @' + f.login + '）', 8, 60);
  }
  function reviewMine(login, ok) {
    const p = pending.get(login);
    if (!p) return;
    pending.delete(login);
    const f = fishes.get(login);
    if (!ok) { if (f) speak(f, '圖片沒有通過，可以換一張再試'); return; }
    registerMine(login, p.display, p.url);
    const prof = profiles[login] || {};
    if (f) {
      f.mine = p.url;
      f.species = 'u:' + login;
      poof(f);
      speak(f, '我的魚通過了！');
      saveProfile(f);
    } else {
      profiles[login] = { ...prof, display: p.display, species: 'u:' + login, mine: p.url };
      dirty.add(login);
    }
  }

  function skinNames() {
    return [...C.SPECIES_IDS.filter((k) => !C.SPECIES[k].rare).map((k) => C.SPECIES[k].name), ...opt.skins.map((k) => k.name)];
  }

  // !頭像 表情符號 → 那個表情放到魚身上；!頭像 大頭貼 → Twitch 大頭貼；!頭像 關 → 拿掉
  // 不讓觀眾貼任意圖片網址：直播畫面上的圖要經過 Twitch（表情、大頭貼）或實況主（自訂魚種）把關
  function setAvatar(f, arg, tags) {
    const a = String(arg || '').trim().toLowerCase();
    const emote = C.firstEmote(tags);
    if (emote) {
      f.avatar = { kind: 'emote', url: C.emoteUrl(emote) };
      poof(f);
      saveProfile(f);
    } else if (['關', '關掉', '取消', 'off', 'none', '拿掉'].includes(a)) {
      f.avatar = null;
      saveProfile(f);
    } else if (['大頭貼', '頭貼', 'pfp', '大頭照'].includes(a)) {
      if (!opt.pfp) { speak(f, '這個頻道沒有開放大頭貼，改用 !頭像 加表情符號', 6, 40); return; }
      fetchPfp(f.login).then((url) => {
        if (!url) { speak(f, '抓不到大頭貼，等一下再試'); return; }
        f.avatar = { kind: 'pfp', url };
        poof(f);
        saveProfile(f);
      });
    } else {
      speak(f, '!頭像 加一個表情符號，或 !頭像 大頭貼' + (opt.pfp ? '' : '（本頻道沒開）'), 6, 40);
    }
  }
  // Twitch 大頭貼網址（decapi.me 是不用登入的公開服務）；只接受 Twitch 自己的圖片網址
  async function fetchPfp(login) {
    try {
      const r = await fetch('https://decapi.me/twitch/avatar/' + encodeURIComponent(login));
      const url = (await r.text()).trim();
      return /^https:\/\/static-cdn\.jtvnw\.net\//.test(url) ? url : null;
    } catch {
      return null;
    }
  }

  function rareHint() {
    const ways = [];
    if (Object.values(opt.rewards).includes('rare')) ways.push('兌換忠誠點');
    if (opt.bits > 0) ways.push(`贊助 ${opt.bits} 小奇點`);
    if (opt.subs) ways.push('訂閱');
    ways.push('搶寶箱');
    return ways.join('、') + '可以解鎖';
  }

  function tankCommand(arg) {
    const a = arg.trim().toLowerCase();
    const review = a.match(/^(ok|核准|通過|yes|no|退回|不通過)\s+@?([a-z0-9_]{2,25})/);
    if (review) return reviewMine(review[2], ['ok', '核准', '通過', 'yes'].includes(review[1]));
    if (a === 'clear' || a === '清空') for (const f of fishes.values()) f.leaving = true;
    else if (a === 'feed' || a === '餵') for (let i = 0; i < 6; i++) dropFood(rx(0.1, 0.9), 5, null);
    else if (a === 'help' || a === '說明') showHelp();
    else if (a === 'shark' || a === '鯊魚') startEvent('shark');
    else if (a === 'whirl' || a === '漩渦') startEvent('whirl');
    else if (a === 'treasure' || a === '寶箱') startEvent('treasure');
  }

  function jump(f) {
    const h = f.y - surfaceY + rand(110, 170) * S;
    f.vy = -Math.sqrt(2 * 900 * S * h);
    f.vx = f.dir * rand(90, 160) * S;
    setState(f, 'jump', 5);
  }

  // ───────── 大事件：鯊魚出沒、大漩渦、寶箱掉落、魚群（揪團） ─────────
  let ev = null;
  let nextEvent = opt.event > 0 ? now + opt.event * 60000 * rand(0.7, 1.3) : Infinity;

  function startEvent(type, by) {
    if (ev && ev.type !== 'school' && type !== 'school') return; // 一次一個（魚群可以疊）
    const who = by && by.display ? by.display : '';
    if (type === 'shark') {
      const dir = Math.random() < 0.5 ? 1 : -1;
      ev = { type, t: 0, dir, x: dir > 0 ? X0 - 260 * S : X1 + 260 * S, y: rand(surfaceY + 120 * S, floorY - 120 * S), L: 230 * S, chomped: 0, tail: 0 };
      banner(`🦈 鯊魚出沒！快逃！${who ? `（${who} 叫來的）` : ''}`);
    } else if (type === 'whirl') {
      ev = { type, t: 0, dur: 8, cx: X0 + TW / 2, cy: (surfaceY + floorY) / 2 };
      banner(`🌀 大漩渦來了！${who ? `（${who} 攪的）` : ''}`);
    } else if (type === 'treasure') {
      ev = { type, t: 0, x: rx(0.15, 0.85), y: surfaceY - 20 * S, landed: false };
      banner(`💰 寶箱掉下來了！第一隻碰到的魚解鎖稀有魚種！${who ? `（${who} 丟的）` : ''}`);
    } else if (type === 'school') {
      const n = clamp(Math.round((by && by.viewers ? by.viewers : 20) / 2), 8, 40);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const cy = rand(surfaceY + 100 * S, floorY - 100 * S);
      const school = [];
      for (let i = 0; i < n; i++) {
        school.push({ x: (dir > 0 ? X0 - 80 * S : X1 + 80 * S) - dir * rand(0, 360) * S, y: cy + rand(-90, 90) * S, ph: rand(0, TAU), c: hslHex(rand(0, 360), 80, 62) });
      }
      schools.push({ dir, list: school, t: 0 });
      if (by && by.login) {
        const f = ensureFish(by);
        unlockRare(f, 'whale', `帶著 ${by.viewers || 0} 位觀眾揪團進來`);
      } else banner('🐟 一大群魚游過去了！');
    }
  }
  const schools = [];

  function updateEvent(dt) {
    if (now > nextEvent) {
      nextEvent = now + opt.event * 60000 * rand(0.7, 1.3);
      if (!ev && fishes.size >= 3) startEvent(['shark', 'whirl', 'treasure'][Math.floor(Math.random() * 3)]);
    }
    for (let i = schools.length - 1; i >= 0; i--) {
      const sc = schools[i];
      sc.t += dt;
      for (const p of sc.list) {
        p.x += sc.dir * 170 * S * dt;
        p.y += Math.sin(now / 400 + p.ph) * 20 * S * dt;
      }
      if (sc.t > 4 && sc.list.every((p) => p.x < X0 - 100 * S || p.x > X1 + 100 * S)) schools.splice(i, 1);
    }
    if (!ev) return;
    ev.t += dt;
    if (ev.type === 'shark') {
      ev.x += ev.dir * 260 * S * dt;
      ev.y += Math.sin(ev.t * 1.5) * 30 * S * dt;
      ev.tail += dt * 10;
      for (const f of fishes.values()) {
        const d = Math.hypot(f.x - ev.x, f.y - ev.y);
        if (f.species === 'shark') { f.flee = 0; continue; } // 觀眾的鯊魚跟著大鯊魚
        if (d < 300 * S && f.state !== 'jump') {
          if (f.flee <= 0) parts.push({ k: 'text', t: '❗', color: '#ff4a4a', x: f.x, y: f.y - extent(f, TOP) - 6 * S, vx: 0, vy: -30 * S, r: 18 * S, life: 0, max: 0.8 });
          f.flee = 1.2;
          f.fleeX = ev.x;
          f.fleeY = ev.y;
          if (d < ev.L * 0.35 && ev.chomped < 3 && !f.chomped) {
            f.chomped = true;
            ev.chomped++;
            jump(f);
            f.spin = 0;
            speak(f, ['救命啊！', '差點被吃掉', '嚇死我了', '我不好吃！'][Math.floor(Math.random() * 4)], 4);
            splash(f.x, f.y, 8);
          }
        }
      }
      if ((ev.dir > 0 && ev.x > X1 + 300 * S) || (ev.dir < 0 && ev.x < X0 - 300 * S)) {
        for (const f of fishes.values()) f.chomped = false;
        ev = null;
      }
    } else if (ev.type === 'whirl') {
      if (ev.t > ev.dur) {
        for (const f of fishes.values()) {
          if (f.state === 'whirl') setState(f, 'swim', 0);
          if (Math.random() < 0.4) speak(f, ['頭好暈 @_@', '再來一次！', '嘔…', '好好玩'][Math.floor(Math.random() * 4)], 3);
        }
        ev = null;
      }
    } else if (ev.type === 'treasure') {
      if (!ev.landed) {
        ev.y += 90 * S * dt;
        if (ev.y >= floorY - 14 * S) { ev.y = floorY - 14 * S; ev.landed = true; bubble(ev.x, ev.y, 5 * S); }
      }
      for (const f of fishes.values()) {
        if (f.leaving || f.state === 'jump') continue;
        if (Math.hypot(f.x - ev.x, f.y - ev.y) < bodyLen(f) * 0.5 + 18 * S) {
          for (let i = 0; i < 20; i++) parts.push({ k: 'spark', x: ev.x, y: ev.y, vx: rand(-160, 160) * S, vy: rand(-220, -40) * S, r: 4 * S, life: 0, max: 0.9, color: '#ffd23f' });
          unlockRare(f, null, '搶到寶箱');
          ev = null;
          return;
        }
      }
      if (ev.t > 40) { banner('寶箱沉到沙裡不見了…'); ev = null; }
    }
  }

  // ───────── 粒子 ─────────
  function bubble(x, y, r, delay = 0) {
    parts.push({ k: 'bubble', x, y, vx: rand(-8, 8) * S, vy: -rand(40, 80) * S, r, life: 0, max: 6, delay });
  }
  function splash(x, y, n) {
    for (let i = 0; i < n; i++) parts.push({ k: 'drop', x: x + rand(-10, 10) * S, y, vx: rand(-90, 90) * S, vy: -rand(120, 260) * S, r: rand(1.5, 3.5) * S, life: 0, max: 1.2 });
  }
  function hearts(x, y, n) {
    for (let i = 0; i < n; i++) parts.push({ k: 'text', t: '❤', color: '#ff5c8a', x: x + rand(-20, 20) * S, y, vx: rand(-20, 20) * S, vy: -rand(30, 70) * S, r: rand(14, 22) * S, life: 0, max: 2 });
  }
  function poof(f) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      parts.push({ k: 'spark', x: f.x, y: f.y, vx: Math.cos(a) * 110 * S, vy: Math.sin(a) * 110 * S, r: 3 * S, life: 0, max: 0.6, color: colorOf(f) });
    }
  }
  // owner：只有這隻魚能吃（null = 大家都能吃）
  function dropFood(x, n, owner) {
    for (let i = 0; i < n; i++) food.push({ x: clamp(x + rand(-40, 40) * S, X0 + 20 * S, X1 - 20 * S), y: surfaceY + rand(-10, 10) * S, ph: rand(0, TAU), life: 0, owner });
  }

  // ───────── 模擬 ─────────
  function update(dt) {
    const t = now / 1000;
    updateEvent(dt);
    separate(dt);
    for (const f of fishes.values()) updateFish(f, dt, t);

    for (let i = food.length - 1; i >= 0; i--) {
      const p = food[i];
      p.life += dt;
      if (p.y < floorY - 4 * S) {
        p.y += 34 * S * dt;
        p.x += Math.sin(t * 2 + p.ph) * 12 * S * dt;
      }
      if (p.life > 25) food.splice(i, 1);
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.k === 'drop') p.vy += 700 * S * dt;
      if (p.k === 'bubble') { p.vx += Math.sin(p.life * 6) * 10 * S * dt; if (p.y < surfaceY) p.life = p.max; }
      if (p.k === 'spark') { p.vx *= 0.9; p.vy *= 0.9; }
      if (p.life >= p.max) parts.splice(i, 1);
    }

    // 背景氣泡與裝飾冒泡
    if (!opt.hide.includes('bubbles') && Math.random() < dt * 1.2 * (TW / 1280)) bubble(rx(0, 1), floorY, rand(1.5, 4) * S);
    for (const e of emitters) {
      const rate = e.kind === 'bubbler' ? 8 : e.kind === 'chest' ? 0.8 : 0.4;
      if (Math.random() < dt * rate) bubble(e.x + rand(-4, 4) * S, e.y, rand(1.5, e.kind === 'bubbler' ? 4 : 6) * S);
    }
  }

  // 魚太近就互相推開，名字和泡泡比較不會疊在一起（抱抱、跟隨中的兩隻除外）
  function separate(dt) {
    const arr = [...fishes.values()];
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (a.other === b.login || b.other === a.login) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = (bodyLen(a) + bodyLen(b)) * 0.5 + 18 * S;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const k = ((min - d) / min) * 140 * S * dt;
        // 垂直方向推多一點：上下錯開時名字就不會疊
        a.vx -= (dx / d) * k; a.vy -= (dy / d) * k * 1.6 + (dy === 0 ? k : 0);
        b.vx += (dx / d) * k; b.vy += (dy / d) * k * 1.6;
      }
    }
  }

  // 只找自己能吃的飼料（給大家的，或指定給自己的）
  function nearestFood(f) {
    let best = null, bd = Infinity;
    for (const p of food) {
      if (p.owner && p.owner !== f.login) continue;
      const d = (p.x - f.x) ** 2 + (p.y - f.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function updateFish(f, dt, t) {
    const sp = spec(f.species);
    const L = bodyLen(f);
    const base = sp.speed * S * (0.9 + f.size * 0.1);
    const idleMs = opt.idle * 60000;
    if (!f.leaving && now - f.last > idleMs) { f.leaving = true; speak(f, '去睡囉 zzz'); }

    f.alpha = clamp(f.alpha + (f.leaving ? -0.6 : 2) * dt, 0, 1);
    if (f.leaving && f.alpha <= 0) { fishes.delete(f.login); return; }
    if (f.sayT > 0) f.sayT -= dt;
    f.puff = Math.max(0, f.puff - dt * 0.35);
    f.flee -= dt;
    f.st -= dt;
    // 鯨魚、獨角鯨偶爾噴水
    if (f.species === 'whale' || f.species === 'narwhal') {
      f.spout -= dt;
      if (f.spout <= 0) {
        f.spout = rand(6, 14);
        for (let i = 0; i < 10; i++) parts.push({ k: 'drop', x: f.x + f.dir * L * 0.15, y: f.y - L * 0.2, vx: rand(-30, 30) * S, vy: -rand(140, 220) * S, r: rand(1.5, 3) * S, life: 0, max: 0.9 });
      }
    }

    // 大漩渦：所有魚繞著中心轉
    if (ev && ev.type === 'whirl' && !f.leaving && f.state !== 'jump') {
      if (f.state !== 'whirl') { setState(f, 'whirl', 0); if (f.wa === undefined) { f.wa = Math.atan2(f.y - ev.cy, f.x - ev.cx); f.wr = Math.hypot(f.x - ev.cx, f.y - ev.cy); const room = Math.min(TW, floorY - surfaceY) * 0.42; f.wTarget = rand(Math.min(60 * S, room * 0.4), room); } }
      const ramp = Math.min(1, ev.t / 1.5) * Math.min(1, (ev.dur - ev.t) / 1.2 + 0.2);
      f.wa += dt * 2.6 * ramp * (140 * S / Math.max(60 * S, f.wr));
      f.wr += (f.wTarget - f.wr) * dt * 0.8;
      const nx = ev.cx + Math.cos(f.wa) * f.wr;
      const ny = ev.cy + Math.sin(f.wa) * f.wr * 0.55;
      f.vx = (nx - f.x) / Math.max(dt, 0.001);
      f.vy = (ny - f.y) / Math.max(dt, 0.001);
      f.x = nx;
      f.y = clamp(ny, surfaceY + L * 0.35, floorY - L * 0.3);
      f.spin += dt * 4 * ramp;
      if (Math.abs(f.vx) > 6 * S) f.dir = Math.sign(f.vx);
      f.face += (f.dir - f.face) * Math.min(1, 8 * dt);
      f.tail += dt * 12;
      return;
    }
    if (f.state === 'whirl') { setState(f, 'swim', 0); f.spin = 0; }
    f.wa = undefined;

    let tx = f.tx, ty = f.ty, speed = base, steer = 1.6;
    const prevY = f.y;

    switch (f.state) {
      case 'enter':
        f.vy += (40 * S - f.vy) * 2 * dt;
        if (f.y > surfaceY + 50 * S) setState(f, 'swim', 0);
        break;
      case 'jump':
        f.vy += 900 * S * dt;
        if (f.vy > 0 && f.y > surfaceY + 30 * S) { setState(f, 'swim', 0); f.vy *= 0.3; }
        break;
      case 'dash':
        tx = f.x + f.dir * 300 * S;
        ty = f.y;
        speed = base * 5;
        steer = 6;
        if (f.st <= 0) setState(f, 'swim', 0);
        break;
      case 'spin':
        f.spin = (1 - Math.max(0, f.st) / 1.2) * TAU * 2;
        speed = base * 0.3;
        if (f.st <= 0) { f.spin = 0; setState(f, 'swim', 0); }
        break;
      case 'sleep':
        tx = f.x;
        ty = floorY - L * 0.35;
        speed = base * 1.2; // 慢慢沉下去，幾秒內到底
        f.zz -= dt;
        if (f.zz <= 0) { f.zz = 1.1; parts.push({ k: 'text', t: 'z', color: '#e8f4ff', x: f.x + f.dir * L * 0.3, y: f.y - L * 0.3, vx: 10 * S, vy: -25 * S, r: rand(12, 18) * S, life: 0, max: 2 }); }
        if (f.st <= 0) setState(f, 'swim', 0);
        break;
      case 'follow':
      case 'hug': {
        const o = fishes.get(f.other);
        if (!o || o.leaving || f.st <= 0) { setState(f, 'swim', 0); f.other = null; break; }
        if (f.state === 'follow') {
          tx = o.x - o.dir * (bodyLen(o) * 0.6 + L * 0.8);
          ty = o.y + Math.sin(t * 2) * 10 * S;
          speed = base * 1.6;
        } else {
          tx = o.x - Math.sign(o.x - f.x || 1) * L * 0.4;
          ty = o.y;
          speed = base * 2.2;
          if (Math.hypot(o.x - f.x, o.y - f.y) < (L + bodyLen(o)) * 0.45) {
            hearts((f.x + o.x) / 2, (f.y + o.y) / 2 - L * 0.3, 6);
            f.dir = Math.sign(o.x - f.x) || 1;
            setState(f, 'swim', 0);
            f.other = null;
          }
        }
        break;
      }
      default: {
        if (ev && ev.type === 'treasure') {
          // 寶箱優先
          tx = ev.x; ty = ev.y; speed = base * 2;
        } else if (ev && ev.type === 'shark' && f.species === 'shark') {
          tx = ev.x - ev.dir * ev.L * 0.6; ty = ev.y + Math.sin(t + f.hue) * 40 * S; speed = base * 3.5;
        } else {
          // 有飼料就去吃，沒有就閒逛
          const p = nearestFood(f);
          if (p) {
            tx = p.x; ty = p.y; speed = base * 1.8;
            if (Math.hypot(p.x - f.x, p.y - f.y) < L * 0.5) { // 碰到身體就算吃到（只看嘴巴的話，魚停在飼料正上方會一直吃不到）
              food.splice(food.indexOf(p), 1);
              f.size = Math.min(2, f.size + 0.04);
              saveProfile(f);
              parts.push({ k: 'text', t: '+', color: '#ffe680', x: f.x, y: f.y - L * 0.4, vx: 0, vy: -40 * S, r: 16 * S, life: 0, max: 0.8 });
            }
          } else {
            f.retarget -= dt;
            if (f.retarget <= 0 || Math.hypot(f.tx - f.x, f.ty - f.y) < 20 * S) pickTarget(f);
          }
        }
      }
    }
    // 逃離鯊魚（睡覺的也會被嚇醒）
    if (f.flee > 0 && f.state !== 'jump') {
      if (f.state === 'sleep') setState(f, 'swim', 0);
      const dx = f.x - f.fleeX, dy = f.y - f.fleeY, d = Math.hypot(dx, dy) || 1;
      tx = f.x + (dx / d) * 200 * S;
      ty = f.y + (dy / d) * 200 * S;
      speed = base * 3.5;
      steer = 5;
    }
    if (f.leaving) { tx = f.dir > 0 ? X1 + 300 * S : X0 - 300 * S; ty = f.y; speed = base * 1.5; }

    if (f.state !== 'jump' && f.state !== 'enter') {
      const dx = tx - f.x, dy = ty - f.y;
      const d = Math.hypot(dx, dy) || 1;
      const s = speed * Math.min(1, d / (60 * S));
      f.vx += ((dx / d) * s - f.vx) * Math.min(1, steer * dt);
      f.vy += ((dy / d) * s * 0.7 - f.vy) * Math.min(1, steer * dt);
      // 水母一縮一放往前
      if (f.species === 'jelly') f.vy += Math.sin(t * 3 + f.hue) * 14 * S * dt;
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (!f.leaving) f.x = TW > L ? clamp(f.x, X0 + L * 0.5, X1 - L * 0.5) : X0 + TW / 2;
    if (f.state !== 'jump' && f.state !== 'enter') f.y = clamp(f.y, surfaceY + L * 0.35, floorY - L * 0.3);
    if ((prevY - surfaceY) * (f.y - surfaceY) < 0 && f.state === 'jump') splash(f.x, surfaceY, 12);

    if (Math.abs(f.vx) > 6 * S && f.state !== 'spin') f.dir = Math.sign(f.vx);
    f.face += (f.dir - f.face) * Math.min(1, 8 * dt);
    const pitchTarget = f.state === 'jump'
      ? Math.atan2(f.vy, Math.abs(f.vx) + 1)
      : clamp(Math.atan2(f.vy, Math.abs(f.vx) + 20 * S) * 0.6, -0.5, 0.5);
    f.pitch += (pitchTarget - f.pitch) * Math.min(1, 10 * dt);
    if (f.state !== 'spin') f.spin *= Math.max(0, 1 - 6 * dt);
    f.tail += dt * (5 + Math.hypot(f.vx, f.vy) / (8 * S));
    if (Math.random() < dt * 0.15) bubble(f.x + f.dir * L * 0.45, f.y, rand(1.5, 3) * S);
  }

  // ───────── 繪製 ─────────
  function draw() {
    const t = now / 1000;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (bgLayer) {
      ctx.drawImage(bgLayer, 0, 0, W, H);
      ctx.save();
      boxPath(ctx);
      ctx.clip();
      if (!opt.hide.includes('rays')) drawRays(t);
      ctx.restore();
    }
    drawSurface(t);
    for (const w of seaweed) drawSeaweed(w, t);
    if (decoLayer) ctx.drawImage(decoLayer, 0, 0, W, H);
    // 魚、鯊魚、魚群只畫在水族箱左右邊界內（游出去就消失）；往上跳可以跳出魚缸
    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, -H, TW, Y1 + H);
    ctx.clip();
    if (ev && ev.type === 'whirl') drawWhirl(t);

    for (const p of food) {
      ctx.fillStyle = '#c98a3c';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 * S, 0, TAU);
      ctx.fill();
    }
    if (ev && ev.type === 'treasure') drawTreasure(t);
    for (const sc of schools) for (const p of sc.list) drawSchoolFish(p, sc.dir, t);

    // 小魚畫在上層，鯊魚等大魚在下層
    const list = [...fishes.values()].sort((a, b) => bodyLen(b) - bodyLen(a));
    for (const f of list) drawFish(f, t);
    if (ev && ev.type === 'shark') drawBigShark();
    for (const p of parts) drawPart(p);
    ctx.restore();
    drawLabels(list);
  }

  function drawRays(t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = X0 + ((i + 0.5) / 5) * TW + Math.sin(t * 0.2 + i * 1.7) * 80 * S;
      const w = (60 + 40 * Math.sin(t * 0.3 + i)) * S * Math.min(1, TW / 800);
      const g = ctx.createLinearGradient(0, surfaceY, 0, floorY);
      g.addColorStop(0, `rgba(${opt.theme.ray},${opt.theme.rayA})`);
      g.addColorStop(1, `rgba(${opt.theme.ray},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, surfaceY);
      ctx.lineTo(x + w * 0.5, surfaceY);
      ctx.lineTo(x + w * 1.6 - 120 * S, floorY);
      ctx.lineTo(x - w * 0.4 - 120 * S, floorY);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSurface(t) {
    if ((opt.bg !== 'tank' && opt.top === 0) || opt.hide.includes('surface')) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,240,255,0.55)';
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    for (let x = X0; x <= X1; x += 10) {
      const y = surfaceY + Math.sin(x * 0.02 + t * 2) * 2.5 * S + Math.sin(x * 0.007 - t * 1.3) * 3 * S;
      x === X0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSeaweed(w, t) {
    ctx.save();
    ctx.strokeStyle = w.color;
    ctx.lineCap = 'round';
    let x = w.x, y = floorY + 8 * S;
    for (let i = 0; i < w.seg; i++) {
      const k = i / w.seg;
      const nx = w.x + Math.sin(t * 1.2 + w.ph + i * 0.6) * 10 * S * k * 2;
      const ny = y - w.h / w.seg;
      ctx.lineWidth = w.w * (1 - k * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;
    }
    ctx.restore();
  }

  function drawWhirl(t) {
    const a = Math.min(1, ev.t / 1, (ev.dur - ev.t) / 1);
    ctx.save();
    ctx.translate(ev.cx, ev.cy);
    ctx.scale(1, 0.55);
    ctx.strokeStyle = `rgba(210,240,255,${0.35 * a})`;
    ctx.lineWidth = 3 * S;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      for (let i = 0; i < 80; i++) {
        const r = i * 4.2 * S;
        const ang = -t * 3 + k * (TAU / 4) + i * 0.09;
        i ? ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r) : ctx.moveTo(0, 0);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTreasure(t) {
    const s = S;
    ctx.save();
    ctx.translate(ev.x, ev.y);
    if (!ev.landed) ctx.rotate(Math.sin(t * 3) * 0.2);
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = (16 + Math.sin(t * 6) * 6) * s;
    ctx.fillStyle = '#a8662e';
    ctx.fillRect(-22 * s, -14 * s, 44 * s, 28 * s);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7a4a22';
    ctx.beginPath();
    ctx.ellipse(0, -14 * s, 22 * s, 10 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(-22 * s, -16 * s, 44 * s, 4 * s);
    ctx.fillRect(-4 * s, -14 * s, 8 * s, 12 * s);
    ctx.restore();
    if (Math.random() < 0.3) parts.push({ k: 'spark', x: ev.x + rand(-26, 26) * s, y: ev.y + rand(-24, 10) * s, vx: 0, vy: -30 * s, r: 2.5 * s, life: 0, max: 0.6, color: '#fff3a0' });
  }

  function drawSchoolFish(p, dir, t) {
    const L = 22 * S;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(dir, 1);
    const sw = Math.sin(t * 14 + p.ph) * L * 0.1;
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.moveTo(-L * 0.35, 0);
    ctx.lineTo(-L * 0.65, -L * 0.22 + sw);
    ctx.lineTo(-L * 0.65, L * 0.22 + sw);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.42, L * 0.2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(L * 0.22, -L * 0.04, L * 0.05, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBigShark() {
    ctx.save();
    ctx.translate(ev.x, ev.y);
    ctx.scale(ev.dir, 1);
    ctx.rotate(Math.sin(ev.t * 1.5) * 0.06);
    drawShark(ev.L, '#5d7286', Math.sin(ev.tail) * ev.L * 0.06, { state: 'swim' }, true);
    ctx.restore();
  }

  function drawPart(p) {
    if (p.delay > 0) return;
    const a = 1 - p.life / p.max;
    ctx.save();
    if (p.k === 'bubble') {
      ctx.globalAlpha = Math.min(1, a * 2) * 0.7;
      ctx.strokeStyle = '#d8f2ff';
      ctx.lineWidth = 1.2 * S;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.25, 0, TAU);
      ctx.fill();
    } else if (p.k === 'drop') {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#bfe9ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    } else if (p.k === 'spark') {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * a + 1, 0, TAU);
      ctx.fill();
    } else if (p.k === 'text') {
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      ctx.font = `700 ${p.r}px "Noto Sans TC", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.t, p.x, p.y);
    }
    ctx.restore();
  }

  function drawFish(f, t) {
    const L = bodyLen(f);
    const c = colorOf(f);
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.translate(f.x, f.y);
    // 稀有魚種有一圈淡淡的光
    if (spec(f.species).rare) {
      const g = ctx.createRadialGradient(0, 0, L * 0.1, 0, 0, L * 0.7);
      g.addColorStop(0, `rgba(255,236,150,${0.22 + Math.sin(t * 3 + f.hue) * 0.06})`);
      g.addColorStop(1, 'rgba(255,236,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, L * 0.7, 0, TAU);
      ctx.fill();
    }
    if (f.species === 'jelly') {
      ctx.rotate(f.spin);
      drawJelly(L, c, t, f);
      if (f.pattern) drawPattern(f, L, c);
      if (f.wear) drawWear(f, L, t);
    } else {
      ctx.scale(f.face, 1);
      ctx.rotate(f.pitch + f.spin);
      const sw = Math.sin(f.tail) * L * 0.09;
      if (spec(f.species).custom) drawSkinImage(L, f);
      else ({ goldfish: drawGoldfish, clown: drawClown, puffer: drawPuffer, angel: drawAngel, shark: drawShark, whale: drawWhale, narwhal: drawNarwhal, koi: drawKoi })[f.species](L, c, sw, f);
      if (f.pattern) drawPattern(f, L, c);
      if (f.wear) drawWear(f, L, t);
    }
    ctx.restore();
    if (f.avatar) drawAvatar(f, L);
  }

  // 魚身的大致形狀（花紋只畫在這裡面）與頭頂、眼睛的位置（配件放這裡），都用身長 L 的倍數
  const BODY = {
    goldfish: { rx: 0.42, ry: 0.26, head: [0.16, -0.24], eye: [0.24, -0.06] },
    clown: { rx: 0.42, ry: 0.24, head: [0.18, -0.22], eye: [0.3, -0.05] },
    puffer: { rx: 0.3, ry: 0.3, head: [0.1, -0.29], eye: [0.15, -0.09] },
    angel: { rx: 0.33, ry: 0.27, head: [0.24, -0.16], eye: [0.26, -0.05] },
    shark: { rx: 0.45, ry: 0.13, head: [0.3, -0.13], eye: [0.36, -0.04] },
    whale: { rx: 0.48, ry: 0.18, head: [0.3, -0.18], eye: [0.32, 0.03] },
    narwhal: { rx: 0.46, ry: 0.15, head: [0.3, -0.14], eye: [0.32, -0.01] },
    koi: { rx: 0.46, ry: 0.18, head: [0.26, -0.16], eye: [0.3, -0.04] },
    jelly: { rx: 0.3, ry: 0.26, head: [0, -0.28], eye: [0.1, -0.1], dome: true },
  };
  function bodyOf(f, L) {
    let b = BODY[f.species];
    if (!b) { // 自訂魚種：用圖片的長寬比
      const im = image(spec(f.species).url);
      const h = im ? (im.naturalHeight / im.naturalWidth) * 0.5 : 0.3;
      b = { rx: 0.42, ry: h * 0.8, head: [0.18, -h * 0.9], eye: [0.3, -h * 0.2] };
    }
    const k = f.species === 'puffer' ? 1 + f.puff * 0.55 : 1;
    return { rx: b.rx * L * k, ry: b.ry * L * k, hx: b.head[0] * L * k, hy: b.head[1] * L * k, ex: b.eye[0] * L * k, ey: b.eye[1] * L * k, dome: b.dome };
  }

  // 花紋：條紋、斑點、星星、愛心（只畫在魚身的後 2/3，不蓋到眼睛）
  function drawPattern(f, L, c) {
    const b = bodyOf(f, L);
    const [r, g, bl] = c[0] === '#' ? hexRgb(c) : [200, 200, 200];
    const ink = r * 0.3 + g * 0.59 + bl * 0.11 > 150 ? 'rgba(40,30,60,0.35)' : 'rgba(255,255,255,0.55)';
    ctx.save();
    ctx.beginPath();
    if (b.dome) ctx.ellipse(0, 0, b.rx, b.ry, 0, Math.PI, 0);
    else ctx.ellipse(0, 0, b.rx * 0.96, b.ry * 0.92, 0, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(-b.rx * 1.2, -b.ry * 1.2, b.rx * (b.dome ? 2.4 : 1.55), b.ry * 2.4);
    ctx.clip();
    ctx.fillStyle = ink;
    const seed = f.hue;
    const u = Math.max(L * 0.05, 2 * S);
    if (f.pattern === 'stripes') {
      for (let x = -b.rx; x < b.rx * 0.4; x += u * 3.2) ctx.fillRect(x, -b.ry * 1.2, u * 1.3, b.ry * 2.4);
    } else {
      for (let i = 0; i < 7; i++) {
        const x = -b.rx * 0.85 + ((seed * (i + 3) * 37) % 100) / 100 * b.rx * 1.2;
        const y = -b.ry * 0.7 + ((seed * (i + 7) * 53) % 100) / 100 * b.ry * 1.4;
        const s = u * (0.8 + ((seed + i * 17) % 5) / 10);
        ctx.beginPath();
        if (f.pattern === 'spots') ctx.arc(x, y, s, 0, TAU);
        else if (f.pattern === 'stars') starPath(x, y, s * 1.4, s * 0.6);
        else heartPath(x, y, s * 1.2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function starPath(x, y, ro, ri) {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? ri : ro;
      i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function heartPath(x, y, s) {
    ctx.moveTo(x, y + s * 0.8);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.2, x, y - s * 0.4);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.2, x + s * 1.4, y - s * 0.2, x, y + s * 0.8);
  }

  // 配件：畫在魚的座標裡（跟著魚轉向、傾斜）
  function drawWear(f, L, t) {
    const b = bodyOf(f, L);
    const u = clamp(L * 0.2, 7 * S, 30 * S);
    const x = b.hx, y = b.hy;
    ctx.save();
    ctx.lineJoin = 'round';
    switch (f.wear) {
      case 'hat': // 禮帽
        ctx.fillStyle = '#22222a';
        ctx.fillRect(x - u * 0.45, y - u * 1.0, u * 0.9, u * 0.95);
        ctx.fillStyle = '#c0304a';
        ctx.fillRect(x - u * 0.45, y - u * 0.3, u * 0.9, u * 0.2);
        ctx.fillStyle = '#22222a';
        ctx.beginPath();
        ctx.ellipse(x, y, u * 0.8, u * 0.16, 0, 0, TAU);
        ctx.fill();
        break;
      case 'crown':
        ctx.fillStyle = '#ffcf3a';
        ctx.strokeStyle = '#c99400';
        ctx.lineWidth = Math.max(1, u * 0.06);
        ctx.beginPath();
        ctx.moveTo(x - u * 0.6, y + u * 0.05);
        ctx.lineTo(x - u * 0.65, y - u * 0.6);
        ctx.lineTo(x - u * 0.3, y - u * 0.3);
        ctx.lineTo(x, y - u * 0.8);
        ctx.lineTo(x + u * 0.3, y - u * 0.3);
        ctx.lineTo(x + u * 0.65, y - u * 0.6);
        ctx.lineTo(x + u * 0.6, y + u * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e8435a';
        for (const dx of [-0.32, 0, 0.32]) { ctx.beginPath(); ctx.arc(x + dx * u, y - u * 0.12, u * 0.09, 0, TAU); ctx.fill(); }
        break;
      case 'glasses': // 墨鏡：一片鏡片蓋在眼睛上，鏡腳往後
        ctx.fillStyle = 'rgba(20,20,30,0.92)';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.2, u * 0.1);
        ctx.beginPath();
        ctx.roundRect(b.ex - u * 0.32, b.ey - u * 0.22, u * 0.64, u * 0.44, u * 0.16);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(b.ex - u * 0.32, b.ey - u * 0.08);
        ctx.lineTo(b.ex - u * 0.95, b.ey - u * 0.2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(b.ex - u * 0.18, b.ey - u * 0.14, u * 0.12, u * 0.12);
        break;
      case 'bow':
        ctx.fillStyle = '#ff6fae';
        ctx.beginPath();
        ctx.moveTo(x - u * 0.15, y - u * 0.15);
        ctx.lineTo(x - u * 0.7, y - u * 0.5);
        ctx.lineTo(x - u * 0.7, y + u * 0.15);
        ctx.closePath();
        ctx.moveTo(x - u * 0.15, y - u * 0.15);
        ctx.lineTo(x + u * 0.4, y - u * 0.5);
        ctx.lineTo(x + u * 0.4, y + u * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e0408a';
        ctx.beginPath();
        ctx.arc(x - u * 0.15, y - u * 0.17, u * 0.16, 0, TAU);
        ctx.fill();
        break;
      case 'pirate':
        ctx.fillStyle = '#1d1d22';
        ctx.beginPath();
        ctx.moveTo(x - u * 0.9, y + u * 0.05);
        ctx.quadraticCurveTo(x - u * 0.6, y - u * 0.9, x, y - u * 0.75);
        ctx.quadraticCurveTo(x + u * 0.6, y - u * 0.9, x + u * 0.9, y + u * 0.05);
        ctx.quadraticCurveTo(x, y - u * 0.2, x - u * 0.9, y + u * 0.05);
        ctx.fill();
        ctx.fillStyle = '#f2f2f2';
        ctx.beginPath();
        ctx.arc(x, y - u * 0.42, u * 0.13, 0, TAU);
        ctx.fill();
        ctx.fillRect(x - u * 0.16, y - u * 0.3, u * 0.32, u * 0.05);
        break;
      case 'flower':
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU - Math.PI / 2;
          ctx.fillStyle = i % 2 ? '#ff8ac0' : '#ffa8d0';
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * u * 0.3, y - u * 0.35 + Math.sin(a) * u * 0.3, u * 0.22, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(x, y - u * 0.35, u * 0.16, 0, TAU);
        ctx.fill();
        break;
      case 'headphones':
        ctx.strokeStyle = '#2b2b38';
        ctx.lineWidth = Math.max(2, u * 0.16);
        ctx.beginPath();
        ctx.arc(x - u * 0.15, y + u * 0.35, u * 0.6, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        ctx.fillStyle = '#ff5a5a';
        ctx.beginPath();
        ctx.ellipse(b.ex - u * 0.55, b.ey, u * 0.22, u * 0.3, 0, 0, TAU);
        ctx.fill();
        break;
      case 'halo': {
        const fy = y - u * 0.55 + Math.sin(t * 3 + f.hue) * u * 0.08;
        ctx.strokeStyle = '#ffe37a';
        ctx.lineWidth = Math.max(2, u * 0.14);
        ctx.shadowColor = '#fff3b0';
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        ctx.ellipse(x, fy, u * 0.5, u * 0.16, 0, 0, TAU);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  // 自訂魚種：實況主上傳的圖（魚頭朝右），跟著尾巴節奏輕輕擺動、伸縮
  function drawSkinImage(L, f) {
    const im = image(spec(f.species).url);
    if (!im) return;
    const h = L * (im.naturalHeight / im.naturalWidth);
    ctx.rotate(Math.sin(f.tail) * 0.06);
    ctx.scale(1 + Math.sin(f.tail * 2) * 0.03, 1);
    ctx.drawImage(im, -L / 2, -h / 2, L, h);
  }

  // 頭像（表情符號或大頭貼）：圓形貼在魚身上，不跟著左右翻轉（字才不會反過來）
  function drawAvatar(f, L) {
    const im = image(f.avatar.url);
    if (!im) return;
    const r = clamp(bodyOf(f, L).ry * 0.95, 8 * S, 40 * S); // 看魚身大小（不含神仙魚的長鰭）
    const x = f.x, y = f.species === 'jelly' ? f.y - L * 0.14 : f.y;
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r + 2 * S, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    if (f.avatar.kind === 'pfp') ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
    else { // 表情符號是透明底，墊一層淡色
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.drawImage(im, x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    }
    ctx.restore();
  }

  function eye(x, y, r, f) {
    if (f.state === 'sleep') {
      ctx.strokeStyle = '#1a1a22';
      ctx.lineWidth = Math.max(1, r * 0.4);
      ctx.beginPath();
      ctx.arc(x, y - r * 0.2, r * 0.8, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#14141c';
    ctx.beginPath();
    ctx.arc(x + r * 0.25, y, r * 0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + r * 0.4, y - r * 0.3, r * 0.22, 0, TAU);
    ctx.fill();
  }

  function bodyFill(L, c, h) {
    const g = ctx.createLinearGradient(0, -h, 0, h);
    g.addColorStop(0, shade(c, 0.25));
    g.addColorStop(0.55, c);
    g.addColorStop(1, shade(c, -0.25));
    return g;
  }

  function drawGoldfish(L, c, sw, f) {
    ctx.fillStyle = shade(c, -0.05);
    ctx.globalAlpha *= 0.9;
    ctx.beginPath();
    ctx.moveTo(-L * 0.3, 0);
    ctx.quadraticCurveTo(-L * 0.55, -L * 0.3 + sw, -L * 0.85, -L * 0.36 + sw * 1.6);
    ctx.quadraticCurveTo(-L * 0.68, sw, -L * 0.85, L * 0.36 + sw * 1.6);
    ctx.quadraticCurveTo(-L * 0.55, L * 0.3 + sw, -L * 0.3, 0);
    ctx.fill();
    ctx.globalAlpha /= 0.9;
    ctx.beginPath();
    ctx.moveTo(-L * 0.18, -L * 0.2);
    ctx.quadraticCurveTo(-L * 0.05, -L * 0.46, L * 0.12, -L * 0.22);
    ctx.fill();
    ctx.fillStyle = bodyFill(L, c, L * 0.26);
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.42, L * 0.26, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(c, 0.35);
    ctx.beginPath();
    ctx.ellipse(-L * 0.02, L * 0.14, L * 0.12, L * 0.05, 0.5 + sw / L, 0, TAU);
    ctx.fill();
    eye(L * 0.24, -L * 0.06, L * 0.065, f);
  }

  function drawClown(L, c, sw, f) {
    const fin = (path) => { ctx.fillStyle = c; ctx.strokeStyle = '#111'; ctx.lineWidth = L * 0.025; ctx.beginPath(); path(); ctx.fill(); ctx.stroke(); };
    fin(() => { ctx.moveTo(-L * 0.36, 0); ctx.quadraticCurveTo(-L * 0.62, -L * 0.28 + sw, -L * 0.6, sw); ctx.quadraticCurveTo(-L * 0.62, L * 0.28 + sw, -L * 0.36, 0); });
    fin(() => { ctx.moveTo(-L * 0.2, -L * 0.18); ctx.quadraticCurveTo(0, -L * 0.42, L * 0.15, -L * 0.2); });
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.42, L * 0.24, 0, 0, TAU);
    ctx.fillStyle = bodyFill(L, c, L * 0.24);
    ctx.fill();
    ctx.clip();
    for (const x of [L * 0.2, -L * 0.04, -L * 0.3]) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = L * 0.025;
      ctx.beginPath();
      ctx.ellipse(x, 0, L * 0.055, L * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = L * 0.02;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.42, L * 0.24, 0, 0, TAU);
    ctx.stroke();
    eye(L * 0.3, -L * 0.05, L * 0.06, f);
  }

  function drawPuffer(L, c, sw, f) {
    const r = L * 0.3 * (1 + f.puff * 0.55);
    ctx.fillStyle = shade(c, -0.15);
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, 0);
    ctx.lineTo(-r * 0.9 - L * 0.22, -L * 0.14 + sw);
    ctx.lineTo(-r * 0.9 - L * 0.22, L * 0.14 + sw);
    ctx.fill();
    if (f.puff > 0.05) {
      ctx.strokeStyle = shade(c, -0.35);
      ctx.lineWidth = L * 0.025;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
        ctx.lineTo(Math.cos(a) * (r + L * 0.1 * f.puff), Math.sin(a) * (r + L * 0.1 * f.puff));
        ctx.stroke();
      }
    }
    ctx.fillStyle = bodyFill(L, c, r);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,250,235,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.fill();
    ctx.fillStyle = shade(c, -0.4);
    for (const [x, y] of [[-0.35, -0.45], [0.05, -0.6], [-0.6, -0.1], [-0.2, -0.15]]) {
      ctx.beginPath();
      ctx.arc(x * r, y * r, r * 0.08, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = shade(c, 0.2);
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.2, L * 0.08, L * 0.035, 0.6 + sw / L * 3, 0, TAU);
    ctx.fill();
    eye(r * 0.5, -r * 0.3, L * 0.085, f);
    ctx.strokeStyle = '#5a3a20';
    ctx.lineWidth = L * 0.02;
    ctx.beginPath();
    ctx.arc(r * 0.85, r * 0.05, L * 0.03, 0, TAU);
    ctx.stroke();
  }

  function drawAngel(L, c, sw, f) {
    const dark = shade(c, -0.45);
    ctx.fillStyle = shade(c, -0.1);
    ctx.beginPath();
    ctx.moveTo(L * 0.05, -L * 0.24);
    ctx.quadraticCurveTo(-L * 0.15, -L * 0.75, -L * 0.42, -L * 0.72 + sw * 0.5);
    ctx.quadraticCurveTo(-L * 0.22, -L * 0.35, -L * 0.22, -L * 0.16);
    ctx.moveTo(L * 0.05, L * 0.24);
    ctx.quadraticCurveTo(-L * 0.15, L * 0.75, -L * 0.42, L * 0.72 + sw * 0.5);
    ctx.quadraticCurveTo(-L * 0.22, L * 0.35, -L * 0.22, L * 0.16);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-L * 0.28, 0);
    ctx.lineTo(-L * 0.5, -L * 0.16 + sw);
    ctx.lineTo(-L * 0.5, L * 0.16 + sw);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L * 0.42, 0);
    ctx.quadraticCurveTo(L * 0.2, -L * 0.34, -L * 0.2, -L * 0.2);
    ctx.lineTo(-L * 0.3, 0);
    ctx.lineTo(-L * 0.2, L * 0.2);
    ctx.quadraticCurveTo(L * 0.2, L * 0.34, L * 0.42, 0);
    ctx.fillStyle = bodyFill(L, c, L * 0.3);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = dark;
    for (const x of [L * 0.18, -L * 0.08]) ctx.fillRect(x, -L, L * 0.06, L * 2);
    ctx.restore();
    eye(L * 0.26, -L * 0.05, L * 0.055, f);
  }

  function drawShark(L, c, sw, f, angry) {
    ctx.fillStyle = shade(c, -0.15);
    ctx.beginPath();
    ctx.moveTo(-L * 0.4, 0);
    ctx.lineTo(-L * 0.68, -L * 0.3 + sw * 1.3);
    ctx.quadraticCurveTo(-L * 0.58, 0, -L * 0.66, L * 0.2 + sw * 1.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-L * 0.1, -L * 0.13);
    ctx.lineTo(-L * 0.02, -L * 0.36);
    ctx.lineTo(L * 0.1, -L * 0.13);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L * 0.5, L * 0.02);
    ctx.quadraticCurveTo(L * 0.35, -L * 0.17, 0, -L * 0.15);
    ctx.quadraticCurveTo(-L * 0.3, -L * 0.1, -L * 0.45, -L * 0.01);
    ctx.lineTo(-L * 0.45, L * 0.03);
    ctx.quadraticCurveTo(-L * 0.3, L * 0.1, 0, L * 0.13);
    ctx.quadraticCurveTo(L * 0.35, L * 0.14, L * 0.5, L * 0.02);
    ctx.fillStyle = bodyFill(L, c, L * 0.15);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = 'rgba(245,248,252,0.95)';
    ctx.beginPath();
    ctx.ellipse(L * 0.05, L * 0.14, L * 0.5, L * 0.1, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = shade(c, -0.2);
    ctx.beginPath();
    ctx.moveTo(L * 0.12, L * 0.08);
    ctx.lineTo(-L * 0.05, L * 0.28 + sw * 0.4);
    ctx.lineTo(L * 0.0, L * 0.08);
    ctx.fill();
    ctx.strokeStyle = shade(c, -0.4);
    ctx.lineWidth = L * 0.012;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(L * (0.22 - i * 0.035), -L * 0.06);
      ctx.lineTo(L * (0.2 - i * 0.035), L * 0.05);
      ctx.stroke();
    }
    if (angry) {
      // 大鯊魚：露出牙齒和兇眼
      ctx.fillStyle = '#2a0f14';
      ctx.beginPath();
      ctx.moveTo(L * 0.47, L * 0.05);
      ctx.quadraticCurveTo(L * 0.38, L * 0.12, L * 0.28, L * 0.07);
      ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 5; i++) {
        const x = L * (0.3 + i * 0.033);
        ctx.beginPath();
        ctx.moveTo(x, L * 0.07);
        ctx.lineTo(x + L * 0.012, L * 0.095);
        ctx.lineTo(x + L * 0.024, L * 0.07);
        ctx.fill();
      }
      ctx.strokeStyle = '#111';
      ctx.lineWidth = L * 0.01;
      ctx.beginPath();
      ctx.moveTo(L * 0.32, -L * 0.08);
      ctx.lineTo(L * 0.39, -L * 0.05);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(L * 0.44, L * 0.06);
      ctx.quadraticCurveTo(L * 0.38, L * 0.09, L * 0.32, L * 0.07);
      ctx.stroke();
    }
    if (f.state === 'sleep') eye(L * 0.36, -L * 0.04, L * 0.03, f);
    else {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(L * 0.36, -L * 0.04, L * 0.025, 0, TAU);
      ctx.fill();
    }
  }

  // 鯨魚和獨角鯨共用身形；slim 讓獨角鯨細一點
  function whaleBody(L, c, sw, slim) {
    const k = slim ? 0.8 : 1;
    ctx.fillStyle = shade(c, -0.15);
    ctx.beginPath();
    ctx.moveTo(-L * 0.46, 0);
    ctx.quadraticCurveTo(-L * 0.58, -L * 0.18 * k + sw, -L * 0.72, -L * 0.15 * k + sw * 1.4);
    ctx.quadraticCurveTo(-L * 0.62, sw, -L * 0.72, L * 0.13 * k + sw * 1.4);
    ctx.quadraticCurveTo(-L * 0.58, L * 0.16 * k + sw, -L * 0.46, 0);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L * 0.5, L * 0.02);
    ctx.bezierCurveTo(L * 0.5, -L * 0.22 * k, L * 0.1, -L * 0.24 * k, -L * 0.2, -L * 0.13 * k);
    ctx.quadraticCurveTo(-L * 0.4, -L * 0.06 * k, -L * 0.5, -L * 0.02 + sw * 0.3);
    ctx.lineTo(-L * 0.5, L * 0.03 + sw * 0.3);
    ctx.quadraticCurveTo(-L * 0.3, L * 0.12 * k, 0, L * 0.17 * k);
    ctx.bezierCurveTo(L * 0.3, L * 0.2 * k, L * 0.5, L * 0.15 * k, L * 0.5, L * 0.02);
    ctx.fillStyle = bodyFill(L, c, L * 0.2 * k);
    ctx.fill();
    ctx.clip();
    return k;
  }

  function drawWhale(L, c, sw, f) {
    whaleBody(L, c, sw, false);
    ctx.fillStyle = 'rgba(238,242,248,0.92)';
    ctx.beginPath();
    ctx.ellipse(L * 0.12, L * 0.17, L * 0.42, L * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,140,170,0.6)';
    ctx.lineWidth = L * 0.008;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(L * 0.42 - i * L * 0.02, L * (0.1 + i * 0.012));
      ctx.lineTo(-L * 0.1, L * (0.12 + i * 0.012));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = shade(c, -0.2);
    ctx.beginPath();
    ctx.ellipse(L * 0.1, L * 0.14, L * 0.12, L * 0.035, 0.5 + sw / L, 0, TAU);
    ctx.fill();
    eye(L * 0.32, L * 0.03, L * 0.028, f);
    ctx.strokeStyle = shade(c, -0.45);
    ctx.lineWidth = L * 0.01;
    ctx.beginPath();
    ctx.moveTo(L * 0.49, L * 0.05);
    ctx.quadraticCurveTo(L * 0.42, L * 0.09, L * 0.28, L * 0.07);
    ctx.stroke();
  }

  function drawNarwhal(L, c, sw, f) {
    // 角
    ctx.strokeStyle = '#f2e6c8';
    ctx.lineWidth = L * 0.025;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(L * 0.46, -L * 0.03);
    ctx.lineTo(L * 0.95, -L * 0.12);
    ctx.stroke();
    ctx.strokeStyle = '#c9b88e';
    ctx.lineWidth = L * 0.008;
    for (let i = 0; i < 6; i++) {
      const x = L * (0.52 + i * 0.07), y = -L * (0.04 + i * 0.013);
      ctx.beginPath();
      ctx.moveTo(x, y - L * 0.012);
      ctx.lineTo(x + L * 0.02, y + L * 0.012);
      ctx.stroke();
    }
    whaleBody(L, c, sw, true);
    ctx.fillStyle = shade(c, -0.35);
    for (let i = 0; i < 14; i++) {
      const x = L * (-0.35 + ((i * 37) % 70) / 100), y = -L * (0.02 + ((i * 13) % 10) / 100);
      ctx.beginPath();
      ctx.ellipse(x, y, L * 0.018, L * 0.01, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    eye(L * 0.32, -L * 0.01, L * 0.03, f);
  }

  function drawKoi(L, c, sw, f) {
    // 沒換色時白底橘紅斑；換了顏色就把斑點換成那個顏色
    const base = f.color ? '#f6f2ea' : c;
    const patch = f.color ? c : '#ff5a2a';
    ctx.fillStyle = shade(base, -0.05);
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.moveTo(-L * 0.38, 0);
    ctx.quadraticCurveTo(-L * 0.6, -L * 0.22 + sw, -L * 0.85, -L * 0.24 + sw * 1.8);
    ctx.quadraticCurveTo(-L * 0.7, sw, -L * 0.85, L * 0.24 + sw * 1.8);
    ctx.quadraticCurveTo(-L * 0.6, L * 0.22 + sw, -L * 0.38, 0);
    ctx.fill();
    ctx.globalAlpha /= 0.85;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.46, L * 0.18, 0, 0, TAU);
    ctx.fillStyle = bodyFill(L, base, L * 0.18);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = patch;
    const h = f.hue;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(L * (0.3 - i * 0.2 + ((h >> i) % 7) / 100), -L * (0.05 + ((h >> (i + 2)) % 5) / 100), L * 0.1, L * 0.08, (h % 3) * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = shade(base, -0.4);
    ctx.lineWidth = L * 0.01;
    ctx.beginPath();
    ctx.moveTo(L * 0.44, L * 0.04);
    ctx.quadraticCurveTo(L * 0.5, L * 0.12, L * 0.46, L * 0.18 + sw * 0.3);
    ctx.stroke();
    eye(L * 0.3, -L * 0.04, L * 0.045, f);
  }

  function drawJelly(L, c, t, f) {
    const pulse = Math.sin(t * 3 + f.hue);
    const R = L * 0.32 * (1 + pulse * 0.07);
    const rh = R * (0.85 - pulse * 0.08);
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 14 * S;
    ctx.strokeStyle = shade(c, 0.3);
    ctx.lineWidth = 2 * S;
    ctx.globalAlpha *= 0.75;
    for (let i = 0; i < 5; i++) {
      const x0 = (-0.7 + i * 0.35) * R;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      for (let k = 1; k <= 6; k++) ctx.lineTo(x0 + Math.sin(t * 3 + i + k * 0.9) * 4 * S * (k / 3), (k / 6) * L * 0.7);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, -rh * 0.4, R * 0.1, 0, -rh * 0.2, R * 1.1);
    g.addColorStop(0, shade(c, 0.6));
    g.addColorStop(1, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, R, rh, 0, Math.PI, 0);
    for (let i = 0; i <= 8; i++) ctx.lineTo(R - (i / 8) * 2 * R, (i % 2 ? 0.12 : 0) * R);
    ctx.fill();
    ctx.restore();
    eye(-R * 0.3, -rh * 0.35, L * 0.05, f);
    eye(R * 0.3, -rh * 0.35, L * 0.05, f);
  }

  function badgeIcon(b) {
    if (b.broadcaster) return '👑 ';
    if (b.mod) return '⚔️ ';
    if (b.vip) return '💎 ';
    if (b.sub) return '⭐ ';
    return '';
  }

  // 名字與泡泡排版：先放泡泡（最新的優先），再放名字；疊到已經放好的就藏起來（淡出），不會擠成一團
  let lastPlaced = []; // 上一幀放好的名字與泡泡（自動測試檢查有沒有重疊）
  function drawLabels(list) {
    const placed = [];
    lastPlaced = placed;
    const hit = (r) => placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
    const fadeStep = Math.min(1, frameDt * 6);
    ctx.save();
    ctx.lineJoin = 'round';

    // 泡泡
    ctx.font = `600 ${Math.round(15 * S)}px "Noto Sans TC", system-ui, sans-serif`;
    const talkers = list.filter((f) => f.sayT > 0 && f.say).sort((a, b) => b.sayAt - a.sayAt);
    let shown = 0;
    for (const f of talkers) {
      if (shown >= MAX_BUBBLES) break;
      const tw = ctx.measureText(f.say).width;
      const bw = tw + 18 * S, bh = 26 * S;
      const bx = clamp(f.x - bw / 2, 4, W - bw - 4);
      const baseY = f.y - extent(f, TOP) - bh - 10 * S;
      // 先試上次的位置（避免跳來跳去），再往上疊
      let box = null;
      for (const k of [f.slot, 0, 1, 2, 3]) {
        const r = { x: bx, y: Math.max(4, baseY - k * (bh + 6 * S)), w: bw, h: bh + 8 * S };
        if (!hit(r)) { box = { ...r, kind: 'say' }; f.slot = k; break; }
      }
      if (!box) continue;
      placed.push(box);
      shown++;
      const by = box.y;
      ctx.globalAlpha = f.alpha * Math.min(1, f.sayT / 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 10 * S);
      ctx.fill();
      // 尾巴指回魚（疊高的泡泡用細線連回去）
      const tipX = clamp(f.x, bx + 10 * S, bx + bw - 10 * S);
      ctx.beginPath();
      ctx.moveTo(tipX - 6 * S, by + bh - 1);
      ctx.lineTo(tipX, by + bh + 8 * S);
      ctx.lineTo(tipX + 6 * S, by + bh - 1);
      ctx.fill();
      if (f.slot > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5 * S;
        ctx.beginPath();
        ctx.moveTo(tipX, by + bh + 8 * S);
        ctx.lineTo(f.x, f.y - extent(f, TOP));
        ctx.stroke();
      }
      ctx.fillStyle = '#1b2733';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.say, bx + bw / 2, by + bh / 2 + 1);
    }

    // 名字：有徽章的、最近講過話的優先
    ctx.font = `700 ${Math.round(13 * S)}px "Noto Sans TC", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3.5 * S;
    ctx.strokeStyle = 'rgba(0,20,40,0.85)';
    const rank = (f) => (f.badges.broadcaster ? 4 : f.badges.mod ? 3 : f.badges.vip || f.badges.sub ? 2 : 0) * 1e9 + f.last;
    for (const f of [...list].sort((a, b) => rank(b) - rank(a))) {
      const name = badgeIcon(f.badges) + f.display;
      const w = ctx.measureText(name).width + 6 * S;
      const r = { x: f.x - w / 2, y: f.y + extent(f, BOTTOM) + 4 * S, w, h: 16 * S };
      const free = !hit(r);
      f.nameA += ((free ? 1 : 0) - f.nameA) * fadeStep;
      if (free) placed.push(r);
      if (f.nameA < 0.03) continue;
      ctx.globalAlpha = f.alpha * f.nameA;
      ctx.strokeText(name, f.x, r.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, f.x, r.y);
    }
    ctx.restore();
  }

  // ───────── 說明卡、提示、大事件橫幅 ─────────
  const helpEl = document.getElementById('help');
  let helpTimer = 0;
  function showHelp() {
    helpEl.classList.add('show');
    clearTimeout(helpTimer);
    helpTimer = setTimeout(() => helpEl.classList.remove('show'), 12000);
  }
  const rareLine = document.getElementById('help-rare');
  if (rareLine) rareLine.textContent = rareHint();

  const bannerEl = document.getElementById('banner');
  let bannerTimer = 0;
  function banner(text) {
    bannerEl.textContent = text;
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth; // 重播動畫
    bannerEl.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 5500);
  }

  const TIPS = [
    '在聊天室輸入 <b>!魚</b> 加入水族箱',
    '<b>!鯊魚</b> <b>!河豚</b> <b>!水母</b> <b>!小丑魚</b> 換魚種',
    '<b>!顏色 粉</b>、<b>!顏色 彩虹</b>、<b>!顏色 #66ccff</b> 換顏色',
    '<b>!跳</b> <b>!衝</b> <b>!轉</b> <b>!睡</b> <b>!泡泡</b> 做動作',
    '<b>!餵</b> 自己吃、<b>!餵 @名字</b> 請別人吃、<b>!餵 大家</b> 全場吃',
    '<b>!頭像</b> 加一個表情符號，把它放到魚身上' + (opt.pfp ? '；<b>!頭像 大頭貼</b> 用 Twitch 大頭貼' : ''),
    '<b>!抱 @名字</b> 抱抱、<b>!跟 @名字</b> 跟著游',
    `稀有魚種 <b>鯨魚</b> <b>獨角鯨</b> <b>錦鯉</b>：${rareHint()}`,
  ];
  if (opt.skins.length) {
    const names = opt.skins.map((k) => '!' + k.name);
    TIPS.splice(2, 0, '本頻道限定魚種：' + names.map((n) => `<b>${n.replace(/</g, '&lt;')}</b>`).join(' '));
    const dt = document.createElement('dt');
    dt.textContent = names.join(' ');
    const dd = document.createElement('dd');
    dd.textContent = '本頻道限定魚種';
    document.querySelector('#help dl').insertBefore(dd, document.querySelector('#help dl dt:nth-of-type(3)'));
    document.querySelector('#help dl').insertBefore(dt, dd);
  }
  const tipEl = document.getElementById('tip');
  if (opt.tip) {
    let i = 0;
    const next = () => {
      tipEl.classList.remove('show');
      setTimeout(() => { tipEl.innerHTML = TIPS[i++ % TIPS.length]; tipEl.classList.add('show'); }, 500);
    };
    next();
    setInterval(next, 9000);
  }

  // ───────── 狀態提示 ─────────
  const statusEl = document.getElementById('status');
  let statusTimer = 0;
  function status(text, keep) {
    statusEl.textContent = text;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    if (!keep) statusTimer = setTimeout(() => statusEl.classList.remove('show'), 4000);
  }

  // ───────── 測試面板 ─────────
  function setupDemo() {
    const el = document.getElementById('demo');
    el.hidden = false;
    if (window.top !== window) el.classList.add('mini'); // 在設定頁的小預覽裡先收起來，點標題旁的按鈕展開
    const nameIn = el.querySelector('[name=user]');
    const textIn = el.querySelector('[name=text]');
    const who = () => {
      const login = (nameIn.value.trim() || 'tester').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'tester';
      return { login, display: nameIn.value.trim() || login, badges: { broadcaster: el.querySelector('[name=mod]').checked } };
    };
    const send = () => {
      handleChat({ ...who(), text: textIn.value });
      textIn.value = '';
      textIn.focus();
    };
    el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
    for (const b of el.querySelectorAll('[data-cmd]')) b.addEventListener('click', () => { textIn.value = b.dataset.cmd; send(); });
    for (const b of el.querySelectorAll('[data-event]')) b.addEventListener('click', () => startEvent(b.dataset.event, { display: '測試' }));
    el.querySelector('[data-act=sub]').addEventListener('click', () => handleChat({ ...who(), notice: true, kind: 'sub' }));
    el.querySelector('[data-act=bits]').addEventListener('click', () => handleChat({ ...who(), text: 'Cheer' + (opt.bits || 100) + ' 鯨魚', tags: { bits: String(opt.bits || 100) } }));
    el.querySelector('[data-act=raid]').addEventListener('click', () => handleChat({ login: 'raider_' + Math.floor(Math.random() * 999), display: '揪團實況主', notice: true, kind: 'raid', viewers: 42 }));

    const BOT_LINES = ['!跳', '!衝', '!轉', '!泡泡', '!餵', '!睡', '哈囉大家', '今天好熱', '!鯊魚', '!水母', '!顏色 彩虹', '!顏色 粉', '!河豚', '早安', '777', '這條魚是我', 'LUL', '晚餐吃什麼', '主播好帥', '第一次來'];
    let bots = 0, botTimer = 0;
    el.querySelector('[data-act=bots]').addEventListener('click', () => {
      for (let i = 0; i < 8; i++) {
        bots++;
        const login = 'bot_fish' + bots;
        handleChat({ login, display: '測試魚' + bots, text: '!魚', badges: { sub: bots % 3 === 0, vip: bots % 7 === 0 } });
      }
      if (!botTimer) {
        botTimer = setInterval(() => {
          const ids = [...fishes.keys()].filter((k) => k.startsWith('bot_'));
          if (!ids.length) return;
          const w = ids[Math.floor(Math.random() * ids.length)];
          let line = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
          if (Math.random() < 0.1 && ids.length > 1) line = (Math.random() < 0.5 ? '!抱 @' : '!跟 @') + ids[Math.floor(Math.random() * ids.length)];
          handleChat({ login: w, display: fishes.get(w).display, text: line, badges: fishes.get(w).badges });
        }, Math.max(150, 1400 / Math.ceil(bots / 8)));
      }
    });
    const hideBtn = el.querySelector('[data-act=hide]');
    const syncBtn = () => { hideBtn.textContent = el.classList.contains('mini') ? '＋' : '－'; };
    hideBtn.addEventListener('click', () => { el.classList.toggle('mini'); syncBtn(); });
    syncBtn();
  }

  // ───────── 啟動 ─────────
  window.addEventListener('resize', resize);
  resize();
  if (opt.demo) setupDemo();
  if (opt.channel) {
    connectChat(opt.channel, handleChat, (s) => {
      if (s === 'joined') status(`🐟 已連上 #${opt.channel} 聊天室`);
      else if (s === 'closed') status('聊天室斷線，重新連線中…', true);
    });
  } else if (!opt.demo) {
    status('網址少了 ?channel=你的頻道名稱', true);
  }
  if (opt.store) {
    cloudLoad();
    setInterval(cloudFlush, 5000);
    setInterval(cloudLoad, 10 * 60000); // 偶爾重讀，實況主在試算表手動改的也會套用
  }

  let last = performance.now();
  let skew = 0; // 自動測試快轉的時間（毫秒）
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    now = ts + skew;
    frameDt = dt;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 方便除錯與自動測試：advance(秒) 直接快轉模擬，不用真的等
  window.FishTank = {
    handleChat, startEvent, fishes, opt,
    advance(sec) {
      for (let i = 0; i < sec * 60; i++) { skew += 1000 / 60; now = performance.now() + skew; update(1 / 60); }
      draw();
    },
    peek: () => ({ ev: ev && ev.type, food: food.length, foodOwners: food.map((p) => p.owner || '*'), seaweed: seaweed.length, pending: [...pending.keys()], schools: schools.length, area: { X0, X1, Y0, Y1, surfaceY, floorY }, banner: bannerEl.textContent, placed: lastPlaced }),
  };
})();
