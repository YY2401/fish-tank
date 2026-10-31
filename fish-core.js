/* 水族箱的純邏輯：聊天指令解析、魚種與顏色、冷卻、Twitch IRC 解析。不碰 DOM，瀏覽器與 Node 共用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FishCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 魚種：scale 是相對大小，speed 是平常游速（像素／秒，再乘上畫面縮放）
  const SPECIES = {
    goldfish: { name: '金魚', color: '#ff8a2a', scale: 1, speed: 55, aliases: ['金魚', 'goldfish', 'gold'] },
    clown: { name: '小丑魚', color: '#ff6a13', scale: 0.9, speed: 65, aliases: ['小丑魚', '小丑', 'clown', 'nemo'] },
    puffer: { name: '河豚', color: '#e6c55a', scale: 0.95, speed: 40, aliases: ['河豚', 'puffer', 'fugu'] },
    angel: { name: '神仙魚', color: '#9fd8ff', scale: 1.05, speed: 45, aliases: ['神仙魚', '神仙', 'angel', 'angelfish'] },
    shark: { name: '鯊魚', color: '#7f95ab', scale: 1.5, speed: 75, aliases: ['鯊魚', '鯊', 'shark'] },
    jelly: { name: '水母', color: '#d68cff', scale: 1, speed: 30, aliases: ['水母', 'jelly', 'jellyfish'] },
    // 稀有魚種：要兌換忠誠點、贊助小奇點、訂閱或搶到寶箱才能用
    whale: { name: '鯨魚', color: '#4f78b8', scale: 2.1, speed: 40, rare: true, aliases: ['鯨魚', '鯨', 'whale'] },
    narwhal: { name: '獨角鯨', color: '#b9c9d6', scale: 1.6, speed: 55, rare: true, aliases: ['獨角鯨', 'narwhal'] },
    koi: { name: '錦鯉', color: '#f4f1ea', scale: 1.3, speed: 50, rare: true, aliases: ['錦鯉', '鯉魚', 'koi'] },
  };
  const SPECIES_IDS = Object.keys(SPECIES);
  const RARE_IDS = SPECIES_IDS.filter((id) => SPECIES[id].rare);

  // 顏色名稱（中英都收）；rainbow 是特殊值，畫的時候色相會一直轉
  const COLORS = {
    紅: '#ff4a4a', red: '#ff4a4a',
    橙: '#ff8a2a', 橘: '#ff8a2a', orange: '#ff8a2a',
    黃: '#ffd23f', yellow: '#ffd23f',
    綠: '#4fd67a', green: '#4fd67a',
    藍: '#3fa4ff', blue: '#3fa4ff',
    青: '#3fe0d8', cyan: '#3fe0d8',
    紫: '#a46bff', purple: '#a46bff',
    粉: '#ff8ccf', 粉紅: '#ff8ccf', pink: '#ff8ccf',
    白: '#f4f4f4', white: '#f4f4f4',
    黑: '#3a3a44', black: '#3a3a44',
    灰: '#9aa3ad', gray: '#9aa3ad', grey: '#9aa3ad',
    金: '#ffc83d', gold: '#ffc83d',
    彩虹: 'rainbow', rainbow: 'rainbow',
  };

  // 指令：canonical → 別名（不含驚嘆號，比對時不分大小寫）
  const COMMANDS = {
    join: ['fish', '魚', 'join', '入缸', '加入'],
    leave: ['leave', '離開', 'bye', '掰掰'],
    skin: ['skin', '換', '變', '變身'],
    color: ['color', 'colour', '顏色', '色'],
    jump: ['jump', '跳'],
    dash: ['dash', '衝', '衝刺'],
    spin: ['spin', '轉', '轉圈', 'dance', '跳舞'],
    sleep: ['sleep', '睡', '睡覺'],
    bubble: ['bubble', '泡泡', '吐泡泡', 'puff', '膨'],
    feed: ['feed', '餵', '餵食', '飼料'],
    follow: ['follow', '跟', '跟隨'],
    hug: ['hug', '抱', '抱抱', 'kiss', '親'],
    avatar: ['avatar', '頭像', '臉'],
    color2: ['color2', '副色', '鰭色', '第二顏色'],
    wearcolor: ['wearcolor', '配件色', '配件顏色'],
    size: ['size', '大小', '體型'],
    tag: ['tag', 'nametag', '名牌'],
    face: ['face', 'expr', '表情', '眼睛'],
    wear: ['wear', '戴', '配件', '穿'],
    pattern: ['pattern', '花紋', '圖案'],
    mine: ['myfish', '我的魚', '我的圖'],
    help: ['fishhelp', '魚說明', '水族箱'],
    tank: ['tank'], // 實況主／管理員專用：!tank clear、!tank feed、!tank shark…
  };
  // 指令在設定頁顯示的名稱與預設叫法（第一個是說明卡、提示裡顯示的那個）；實況主可以改叫法或關掉
  const CMD_INFO = {
    join: { name: '加入', words: ['魚', 'fish', 'join', '入缸', '加入'] },
    leave: { name: '離開', words: ['離開', 'leave', 'bye', '掰掰'] },
    skin: { name: '換魚種', words: ['變', 'skin', '換', '變身'] },
    color: { name: '換顏色', words: ['顏色', 'color', 'colour', '色'] },
    color2: { name: '副色', words: ['副色', 'color2', '鰭色', '第二顏色'] },
    wearcolor: { name: '配件色', words: ['配件色', 'wearcolor', '配件顏色'] },
    jump: { name: '跳', words: ['跳', 'jump'] },
    dash: { name: '衝刺', words: ['衝', 'dash', '衝刺'] },
    spin: { name: '轉圈', words: ['轉', 'spin', '轉圈', 'dance', '跳舞'] },
    sleep: { name: '睡覺', words: ['睡', 'sleep', '睡覺'] },
    bubble: { name: '吐泡泡', words: ['泡泡', 'bubble', '吐泡泡', 'puff', '膨'] },
    feed: { name: '餵食', words: ['餵', 'feed', '餵食', '飼料'] },
    follow: { name: '跟隨', words: ['跟', 'follow', '跟隨'] },
    hug: { name: '抱抱', words: ['抱', 'hug', '抱抱', 'kiss', '親'] },
    avatar: { name: '頭像', words: ['頭像', 'avatar', '臉'] },
    wear: { name: '配件', words: ['戴', 'wear', '配件', '穿'] },
    pattern: { name: '花紋', words: ['花紋', 'pattern', '圖案'] },
    size: { name: '大小', words: ['大小', 'size', '體型'] },
    tag: { name: '名牌', words: ['名牌', 'tag', 'nametag'] },
    face: { name: '表情', words: ['表情', 'face', 'expr', '眼睛'] },
    mine: { name: '提交自己的魚', words: ['我的魚', 'myfish', '我的圖'] },
    help: { name: '說明卡', words: ['fishhelp', '魚說明', '水族箱'] },
  };
  // 叫法清單 → { 叫法: 指令 }。words：{ 指令: [叫法…] }（沒給就用預設）；off：關掉的指令
  function buildAliases(words = {}, off = []) {
    const map = {};
    for (const [cmd, list] of Object.entries(COMMANDS)) {
      if (off.includes(cmd)) continue;
      for (const a of (cmd !== 'tank' && words[cmd]) || list) if (!map[a.toLowerCase()]) map[a.toLowerCase()] = cmd;
    }
    // 直接打魚種名稱也能變身，例如 !鯊魚
    if (!off.includes('skin')) for (const [id, sp] of Object.entries(SPECIES)) for (const a of sp.aliases) if (!map[a.toLowerCase()]) map[a.toLowerCase()] = 'skin:' + id;
    return map;
  }
  const ALIAS = buildAliases();
  // 「魚、join，入缸」→ ['魚', 'join', '入缸']（逗號、頓號、空白都可以分）
  const splitWords = (v) => String(v || '').split(/[\s,，、]+/).map((w) => w.trim().replace(/^[!！]/, '')).filter(Boolean).slice(0, 8);

  // 各指令的個人冷卻（毫秒）
  // 配件（戴在魚頭上）與花紋（畫在魚身上）：全部用程式畫，不用圖片
  const WEARS = {
    hat: { name: '帽子', aliases: ['帽子', '禮帽', 'hat'] },
    crown: { name: '皇冠', aliases: ['皇冠', '王冠', 'crown'] },
    glasses: { name: '眼鏡', aliases: ['眼鏡', '墨鏡', 'glasses'] },
    bow: { name: '蝴蝶結', aliases: ['蝴蝶結', '緞帶', 'bow'] },
    pirate: { name: '海盜帽', aliases: ['海盜帽', '海盜', 'pirate'] },
    flower: { name: '花', aliases: ['花', '小花', 'flower'] },
    headphones: { name: '耳機', aliases: ['耳機', 'headphones'] },
    halo: { name: '光環', aliases: ['光環', '天使', 'halo'] },
  };
  const PATTERNS = {
    stripes: { name: '條紋', aliases: ['條紋', '斑馬', 'stripes'] },
    spots: { name: '斑點', aliases: ['斑點', '點點', 'spots', 'dots'] },
    stars: { name: '星星', aliases: ['星星', 'stars'] },
    hearts: { name: '愛心', aliases: ['愛心', 'hearts'] },
  };
  const EXPRESSIONS = {
    happy: { name: '開心', aliases: ['開心', '笑', 'happy'] },
    angry: { name: '生氣', aliases: ['生氣', '怒', 'angry'] },
    love: { name: '愛心眼', aliases: ['愛心眼', '愛心', 'love'] },
    sleepy: { name: '想睡', aliases: ['想睡', '睏', 'sleepy'] },
    surprised: { name: '驚訝', aliases: ['驚訝', '嚇到', 'surprised'] },
    star: { name: '星星眼', aliases: ['星星眼', '星星', 'star'] },
    wink: { name: '眨眼', aliases: ['眨眼', 'wink'] },
    dizzy: { name: '暈', aliases: ['暈', '頭暈', 'dizzy'] },
  };
  const SIZES = {
    small: { name: '小', k: 0.75, aliases: ['小', 's', 'small'] },
    medium: { name: '中', k: 1, aliases: ['中', '普通', 'm', 'medium'] },
    large: { name: '大', k: 1.35, aliases: ['大', 'l', 'large'] },
  };
  const OFF = ['關', '關掉', '取消', '拿掉', '不要', 'off', 'none'];
  // 「帽子」「crown」→ ID；「關」→ ''；不認得 → null
  function findIn(table, word) {
    const w = String(word || '').trim().toLowerCase();
    if (OFF.includes(w)) return '';
    for (const [id, it] of Object.entries(table)) if (id === w || it.aliases.some((a) => a.toLowerCase() === w)) return id;
    return null;
  }
  const findWear = (w) => findIn(WEARS, w);
  const findPattern = (w) => findIn(PATTERNS, w);
  const findExpression = (w) => findIn(EXPRESSIONS, w);
  const findSize = (w) => findIn(SIZES, w);

  // 圖片網址：https，或設定頁縮小後直接放進網址的圖（data:image/…;base64）
  const IMAGE_URL = /^(https:\/\/\S+|data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$/;

  const COOLDOWN = { jump: 4000, dash: 3000, spin: 4000, bubble: 3000, feed: 15000, hug: 8000, skin: 5000, color: 3000, help: 30000, wear: 3000, pattern: 3000, mine: 60000, color2: 3000, wearcolor: 3000, size: 5000, tag: 3000, face: 3000 };

  // 大事件與忠誠點品項可以觸發的動作
  const EVENTS = { shark: '鯊魚出沒', whirl: '大漩渦', treasure: '寶箱掉落', school: '魚群' };
  const REWARD_ACTIONS = { rare: '解鎖稀有魚種', shark: '鯊魚出沒', whirl: '大漩渦', treasure: '寶箱掉落', feed: '全場撒飼料' };
  const DECOS = { castle: '城堡', chest: '寶箱', coral: '珊瑚', bubbler: '打氣石' };

  // 魚缸配色：水面上方（空氣）、海水由淺到深三段、沙子上下、石頭上下、海草顏色、光線顏色
  const THEMES = {
    ocean: { name: '海洋', air: ['#0b1622', '#14324a'], water: ['#1d7fb0', '#0f5582', '#07304f'], sand: ['#d8bf86', '#8f744a'], rock: ['#6d7a86', '#2f3942'], weed: ['#2f8a4f', '#3c9a5c', '#c4506a'], ray: '160,220,255', rayA: 0.1 },
    tropical: { name: '熱帶淺海', air: ['#7fd8f5', '#b8eefc'], water: ['#3fd0d4', '#1aa3b8', '#0b6b85'], sand: ['#f3e2b0', '#c9a96b'], rock: ['#9a8f7f', '#5a5245'], weed: ['#3cc46a', '#7be08a', '#ff7aa8'], ray: '255,255,220', rayA: 0.14 },
    deep: { name: '深海', air: ['#02060f', '#061225'], water: ['#0b2a52', '#06173a', '#020814'], sand: ['#3a3f52', '#1d2030'], rock: ['#2b3346', '#10141f'], weed: ['#1f6f6a', '#2a8a7e', '#5a3a9a'], ray: '120,180,255', rayA: 0.05 },
    sunset: { name: '夕陽', air: ['#ff9f5a', '#ffc58a'], water: ['#ff9a6b', '#c45a8a', '#4a2a6a'], sand: ['#e8b98a', '#9a6a5a'], rock: ['#8a6a7a', '#4a3040'], weed: ['#4aa06a', '#d06a8a', '#f0a050'], ray: '255,220,180', rayA: 0.12 },
    night: { name: '夜晚', air: ['#05081a', '#101a3a'], water: ['#1b3a6a', '#0f2246', '#060f24'], sand: ['#5a5a70', '#2a2a3a'], rock: ['#3a4058', '#161a28'], weed: ['#2f6a5a', '#3a7a6a', '#6a4a9a'], ray: '200,220,255', rayA: 0.05 },
    candy: { name: '夢幻粉', air: ['#ffe0f0', '#ffc8e4'], water: ['#ffb3d9', '#c79bff', '#8a6bff'], sand: ['#fff0f5', '#f0c0d8'], rock: ['#d8a8d0', '#9a70a8'], weed: ['#7be0c0', '#ff8ac0', '#ffd36b'], ray: '255,255,255', rayA: 0.15 },
    lake: { name: '湖泊', air: ['#a8d0e8', '#cfe6f2'], water: ['#5aa86a', '#2f7a55', '#173f30'], sand: ['#8a7a5a', '#4a3f2a'], rock: ['#6a6a5a', '#33332a'], weed: ['#4a9a3a', '#6ab04a', '#2f7a3a'], ray: '220,255,200', rayA: 0.08 },
  };
  // 可以關掉的畫面元素（裝飾另外勾）
  const LAYERS = { rays: '光線', rocks: '石頭', sand: '沙地', bubbles: '背景氣泡', surface: '水面線' };

  // 「#hex」→ 合法的六碼色，不合法回傳 null
  const hex6 = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || '').trim()) ? '#' + String(v).trim().replace('#', '').toLowerCase() : null);

  // 兩個顏色中間的顏色（t = 0～1）
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
    return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
  }

  // 網址參數 → 背景配色：主題，再套上自訂的顏色
  // water=水面,深處 或 水面,中間,深處；air=天空；sand、rock、weed（海草）；ray（光線）；line（水面線）
  function resolveTheme(id, water, sand, more = {}) {
    const base = THEMES[id] || THEMES.ocean;
    const t = { ...base, water: base.water.slice(), sand: base.sand.slice(), air: base.air.slice(), rock: base.rock.slice(), weed: base.weed.slice(), line: base.line || '#c8f0ff' };
    const w = String(water || '').split(',').map(hex6);
    if (w.length === 2 && w[0] && w[1]) t.water = [w[0], mixHex(w[0], w[1], 0.5), w[1]];
    if (w.length === 3 && w.every(Boolean)) t.water = w;
    const sd = hex6(sand);
    if (sd) t.sand = [sd, mixHex(sd, '#000000', 0.35)];
    const air = hex6(more.air);
    if (air) t.air = [mixHex(air, '#000000', 0.25), air];
    const rock = hex6(more.rock);
    if (rock) t.rock = [rock, mixHex(rock, '#000000', 0.55)];
    const weed = hex6(more.weed);
    if (weed) t.weed = [weed, mixHex(weed, '#000000', 0.2), mixHex(weed, '#ffffff', 0.3)];
    const ray = hex6(more.ray);
    if (ray) { const n = parseInt(ray.slice(1), 16); t.ray = `${n >> 16},${(n >> 8) & 255},${n & 255}`; }
    const line = hex6(more.line);
    if (line) t.line = line;
    return t;
  }

  // ── 魚缸物件 ──
  // 物件種類（畫法在 objects.js）；網址參數 objs=種類~x~y~大小~翻轉~顏色|…
  // x、y 是在魚缸範圍裡的位置（0～1，y 是物件底部；空白 = 放在沙地上）；自訂圖片的種類是 img0、img1…（對應 oimg 參數）
  const OBJECT_IDS = ['castle', 'chest', 'coral', 'bubbler', 'ship', 'helmet', 'shell', 'starfish', 'rock', 'plant', 'anchor', 'pillar', 'seaweed'];
  const num3 = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  function parseObjects(str, imgCount = 0) {
    const out = [];
    for (const part of String(str || '').split('|')) {
      const [t, x, y, sc, f, c] = part.split('~');
      const img = /^img(\d)$/.exec(t || '');
      if (!OBJECT_IDS.includes(t) && !(img && +img[1] < imgCount)) continue;
      out.push({ t, x: num3(x, 0, 1, 0.5), y: y === '' || y === undefined ? null : num3(y, 0, 1, null), s: num3(sc, 0.2, 4, 1), f: f === '1', c: hex6(c) || '' });
      if (out.length >= 40) break;
    }
    return out;
  }
  function stringifyObjects(list) {
    const r = (v, d) => String(+(+v).toFixed(d));
    return (list || []).map((o) => [o.t, r(o.x, 3), o.y === null || o.y === undefined ? '' : r(o.y, 3), r(o.s, 2), o.f ? '1' : '0', (o.c || '').replace('#', '')].join('~')).join('|');
  }
  // 舊網址的 deco=城堡,寶箱… → 平均排在沙地上
  function decoToObjects(deco) {
    return deco.map((t, i) => ({ t, x: ((i + 0.5) / deco.length) * 0.84 + 0.08, y: null, s: 1, f: false, c: '' }));
  }

  // 「品項ID:動作,品項ID:動作」↔ { 品項ID: 動作 }
  function parseRewards(str) {
    const out = {};
    for (const part of String(str || '').split(',')) {
      const [id, act] = part.split(':').map((x) => (x || '').trim());
      if (id && REWARD_ACTIONS[act]) out[id] = act;
    }
    return out;
  }
  function stringifyRewards(map) {
    return Object.entries(map || {}).filter(([id, act]) => id && REWARD_ACTIONS[act]).map(([id, act]) => id + ':' + act).join(',');
  }

  // 還沒解鎖的稀有魚種裡挑一個（想要的那隻優先）；全部都有了回傳 null
  function pickRare(unlocked, want, rnd = Math.random) {
    const left = RARE_IDS.filter((id) => !(unlocked || []).includes(id));
    if (want && left.includes(want)) return want;
    return left.length ? left[Math.floor(rnd() * left.length)] : null;
  }

  function findSpecies(word) {
    if (!word) return null;
    const w = String(word).trim().toLowerCase();
    for (const [id, sp] of Object.entries(SPECIES)) if (id === w || sp.aliases.some((a) => a.toLowerCase() === w)) return id;
    return null;
  }

  function findColor(word) {
    if (!word) return null;
    const w = String(word).trim().toLowerCase().replace(/色$/, '');
    if (/^#?[0-9a-f]{6}$/.test(w)) return '#' + w.replace('#', '');
    if (/^#?[0-9a-f]{3}$/.test(w)) return '#' + w.replace('#', '').split('').map((c) => c + c).join('');
    return COLORS[w] || null;
  }

  const EVERYONE = ['大家', '全部', '所有人', 'all', 'everyone'];

  // 「!指令 參數」→ { cmd, arg, target }；不是指令回傳 null
  // skins：實況主自訂的魚種（直接打 !名字 也能變身）
  // target：!抱／!跟 的對象；!餵 的對象（null = 只給自己，'*' = 給大家）
  function parseCommand(text, skins = [], aliases = ALIAS) {
    const m = String(text || '').trim().match(/^[!！]\s*(\S+)\s*(.*)$/);
    if (!m) return null;
    let cmd = aliases[m[1].toLowerCase()];
    const custom = !cmd && skins.find((k) => k.name.toLowerCase() === m[1].toLowerCase());
    if (custom) cmd = 'skin:' + custom.id;
    if (!cmd) return null;
    let arg = m[2].trim();
    if (cmd.startsWith('skin:')) { arg = cmd.slice(5); cmd = 'skin'; }
    const at = arg.match(/^@?([A-Za-z0-9_]{2,25})\b/);
    let target = (cmd === 'follow' || cmd === 'hug' || cmd === 'feed') && at ? at[1].toLowerCase() : null;
    if (cmd === 'feed' && EVERYONE.includes(arg.toLowerCase())) target = '*';
    return { cmd, arg, target };
  }

  // 訊息裡第一個 Twitch 表情符號的 ID（IRC 標籤 emotes=25:0-4,12-16/1902:6-10）
  function firstEmote(tags) {
    let best = null;
    for (const part of String((tags && tags.emotes) || '').split('/')) {
      const [id, ranges] = part.split(':');
      if (!id || !ranges) continue;
      for (const r of ranges.split(',')) {
        const start = parseInt(r, 10);
        if (Number.isFinite(start) && (!best || start < best.start)) best = { id, start };
      }
    }
    return best && best.id;
  }
  const emoteUrl = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`;

  // 實況主自訂魚種：網址參數 skin=名字|圖片網址（可以有好幾個）
  function parseSkins(list) {
    const out = [];
    for (const raw of list || []) {
      const i = String(raw).indexOf('|');
      if (i < 1) continue;
      const name = raw.slice(0, i).trim().replace(/^[!！]/, '').slice(0, 12);
      const url = raw.slice(i + 1).trim();
      if (!name || !IMAGE_URL.test(url) || out.some((k) => k.name === name)) continue;
      out.push({ id: 'c:' + name, name, url });
    }
    return out;
  }

  // 冷卻檢查：可以執行就記下時間並回傳 true
  function cooldownOk(map, user, cmd, now, scale = 1) {
    const ms = (COOLDOWN[cmd] || 0) * scale;
    if (!ms) return true;
    const key = user + '|' + cmd;
    if (key in map && now - map[key] < ms) return false;
    map[key] = now;
    return true;
  }

  // Twitch IRC 一行 → { command, tags, login, channel, text }
  function unescapeTag(v) {
    return v.replace(/\\(s|:|\\|r|n)/g, (_, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' })[c]);
  }
  function parseIrc(line) {
    let rest = line;
    const tags = {};
    if (rest[0] === '@') {
      const sp = rest.indexOf(' ');
      for (const kv of rest.slice(1, sp).split(';')) {
        const i = kv.indexOf('=');
        tags[i < 0 ? kv : kv.slice(0, i)] = i < 0 ? '' : unescapeTag(kv.slice(i + 1));
      }
      rest = rest.slice(sp + 1);
    }
    let prefix = '';
    if (rest[0] === ':') {
      const sp = rest.indexOf(' ');
      prefix = rest.slice(1, sp);
      rest = rest.slice(sp + 1);
    }
    const ti = rest.indexOf(' :');
    const head = (ti < 0 ? rest : rest.slice(0, ti)).split(' ');
    let text = ti < 0 ? '' : rest.slice(ti + 2);
    const m = text.match(/^\u0001ACTION (.*)\u0001$/);
    if (m) text = m[1];
    return {
      command: head[0],
      channel: (head[1] || '').replace(/^#/, ''),
      login: prefix.split('!')[0].toLowerCase(),
      tags,
      text,
    };
  }

  function badgesOf(tags) {
    const b = tags.badges || '';
    return {
      broadcaster: /(^|,)broadcaster\//.test(b),
      mod: tags.mod === '1' || /(^|,)moderator\//.test(b),
      vip: /(^|,)vip\//.test(b),
      sub: tags.subscriber === '1' || /(^|,)(subscriber|founder)\//.test(b),
    };
  }

  // USERNOTICE（訂閱、送訂閱、揪團）→ { kind, login, display, viewers }；其他通知回傳 null
  function noticeOf(m) {
    const t = m.tags || {};
    const id = t['msg-id'];
    const who = { login: (t.login || m.login || '').toLowerCase(), display: t['display-name'] || t.login || m.login };
    if (id === 'sub' || id === 'resub') return { kind: 'sub', ...who };
    if (id === 'subgift' || id === 'anonsubgift') {
      return { kind: 'sub', login: (t['msg-param-recipient-user-name'] || '').toLowerCase(), display: t['msg-param-recipient-display-name'] || t['msg-param-recipient-user-name'] };
    }
    if (id === 'raid') return { kind: 'raid', login: (t['msg-param-login'] || who.login).toLowerCase(), display: t['msg-param-displayName'] || who.display, viewers: +t['msg-param-viewerCount'] || 0 };
    return null;
  }

  // 上下（左右）留白加起來太多時等比例縮小，水族箱至少留畫面的 15%
  function fitArea(top, bottom, left, right) {
    const fit = (a, b) => {
      const sum = a + b;
      return sum > 0.85 ? [(a / sum) * 0.85, (b / sum) * 0.85] : [a, b];
    };
    const [t, bo] = fit(top, bottom);
    const [l, r] = fit(left, right);
    return { top: t, bottom: bo, left: l, right: r };
  }

  // ── 外觀、文字、手感、大事件：設定頁照這份清單畫表單，水族箱照這份清單讀網址參數 ──
  // type：color、range（min/max/step）、number、select（options）、check、text、lines（多行，用 | 存）
  const FONTS = { sans: '黑體', serif: '明體', kai: '楷書', round: '圓體', system: '系統字型' };
  const SETTINGS = [
    // 字型與名牌
    { k: 'font', g: 'style', label: '字型', type: 'select', options: FONTS, def: 'sans' },
    { k: 'nsize', g: 'style', label: '名字大小', type: 'range', min: 8, max: 32, step: 1, def: 13 },
    { k: 'ncolor', g: 'style', label: '名字顏色', type: 'color', def: '#ffffff' },
    { k: 'nline', g: 'style', label: '名字外框', type: 'color', def: '#001428' },
    // 對話泡泡
    { k: 'bsize', g: 'style', label: '泡泡字大小', type: 'range', min: 10, max: 36, step: 1, def: 15 },
    { k: 'bbg', g: 'style', label: '泡泡底色', type: 'color', def: '#ffffff' },
    { k: 'btext', g: 'style', label: '泡泡文字', type: 'color', def: '#1b2733' },
    { k: 'nbub', g: 'style', label: '同時最多幾個泡泡', type: 'number', min: 0, max: 30, def: 8 },
    { k: 'bsec', g: 'style', label: '泡泡顯示幾秒', type: 'number', min: 2, max: 30, def: 6 },
    // 橫幅、提示、說明卡
    { k: 'gbg', g: 'style', label: '橫幅底色（左）', type: 'color', def: '#ff8a2a' },
    { k: 'gbg2', g: 'style', label: '橫幅底色（右）', type: 'color', def: '#ffcf3f' },
    { k: 'gtext', g: 'style', label: '橫幅文字', type: 'color', def: '#2a1400' },
    { k: 'tbg', g: 'style', label: '提示與說明卡底色', type: 'color', def: '#041e34' },
    { k: 'ttext', g: 'style', label: '提示與說明卡文字', type: 'color', def: '#e6f6ff' },
    { k: 'tkey', g: 'style', label: '指令強調色', type: 'color', def: '#ffd84a' },
    // 魚缸外框
    { k: 'glass', g: 'look', label: '不是全畫面時畫玻璃魚缸外框', type: 'check', def: true },
    { k: 'gcol', g: 'look', label: '魚缸外框顏色', type: 'color', def: '#c8ebff' },
    // 手感
    { k: 'cd', g: 'tune', label: '指令冷卻倍率（0 = 不冷卻）', type: 'range', min: 0, max: 3, step: 0.1, def: 1 },
    { k: 'spd', g: 'tune', label: '魚游泳速度', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1 },
    { k: 'grow', g: 'tune', label: '每吃一顆飼料長大多少', type: 'range', min: 0, max: 0.2, step: 0.01, def: 0.04 },
    { k: 'maxsize', g: 'tune', label: '最大能長到幾倍', type: 'range', min: 1, max: 4, step: 0.1, def: 2 },
    // 大事件
    { k: 'ev', g: 'event', label: '隨機出現哪些大事件', type: 'multi', options: { shark: '鯊魚出沒', whirl: '大漩渦', treasure: '寶箱掉落' }, def: 'shark,whirl,treasure' },
    { k: 'shc', g: 'event', label: '鯊魚顏色', type: 'color', def: '#5d7286' },
    { k: 'shs', g: 'event', label: '鯊魚大小', type: 'range', min: 0.5, max: 2.5, step: 0.1, def: 1 },
    { k: 'shsp', g: 'event', label: '鯊魚速度', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1 },
    { k: 'chomp', g: 'event', label: '鯊魚最多咬飛幾隻', type: 'number', min: 0, max: 20, def: 3 },
    { k: 'whirl', g: 'event', label: '漩渦轉幾秒', type: 'number', min: 3, max: 30, def: 8 },
    { k: 'whc', g: 'event', label: '漩渦線條顏色', type: 'color', def: '#d2f0ff' },
    { k: 'trc', g: 'event', label: '寶箱顏色', type: 'color', def: '#a8662e' },
    { k: 'tsec', g: 'event', label: '寶箱沒人搶幾秒後消失', type: 'number', min: 10, max: 180, def: 40 },
    { k: 'scc', g: 'event', label: '揪團魚群顏色（空白 = 彩色）', type: 'color', def: '', empty: '彩色' },
    // 文字內容：{名字} {原因} {魚種} 會換成實際的內容；多行的每一行是一句，隨機挑
    { k: 'x_shark', g: 'text', label: '鯊魚出沒的橫幅', type: 'text', def: '鯊魚出沒！快逃！' },
    { k: 'x_whirl', g: 'text', label: '大漩渦的橫幅', type: 'text', def: '大漩渦來了！' },
    { k: 'x_treasure', g: 'text', label: '寶箱掉落的橫幅', type: 'text', def: '寶箱掉下來了！第一隻碰到的魚解鎖稀有魚種！' },
    { k: 'x_lost', g: 'text', label: '寶箱沒人搶到', type: 'text', def: '寶箱沉到沙裡不見了…' },
    { k: 'x_school', g: 'text', label: '魚群游過的橫幅', type: 'text', def: '一大群魚游過去了！' },
    { k: 'x_by', g: 'text', label: '誰叫來的（接在大事件後面）', type: 'text', def: '（{名字} 叫來的）' },
    { k: 'x_unlock', g: 'text', label: '解鎖稀有魚種的橫幅', type: 'text', def: '{名字} {原因}，解鎖稀有魚種「{魚種}」！' },
    { k: 'x_allrare', g: 'text', label: '稀有魚種都有了', type: 'text', def: '{名字} {原因}，稀有魚種都收集齊了，直接變大！' },
    { k: 'x_join', g: 'text', label: '魚剛加入時說的話', type: 'text', def: '我在這裡！' },
    { k: 'x_leave', g: 'text', label: '魚離開時說的話', type: 'text', def: '掰掰～' },
    { k: 'x_idle', g: 'text', label: '太久沒講話游走時說的話', type: 'text', def: '去睡囉 zzz' },
    { k: 'x_scream', g: 'text', label: '被鯊魚咬到時說的話', type: 'lines', def: '救命啊！|差點被吃掉|嚇死我了|我不好吃！' },
    { k: 'x_dizzy', g: 'text', label: '漩渦結束時說的話', type: 'lines', def: '頭好暈 @_@|再來一次！|嘔…|好好玩' },
    { k: 'x_help', g: 'text', label: '說明卡標題', type: 'text', def: '水族箱指令' },
    { k: 'x_tips', g: 'text', label: '左下角輪播提示（一行一句；{跳} 這種寫法會換成目前的指令）', type: 'lines',
      def: '在聊天室輸入 {魚} 加入水族箱|!鯊魚 !河豚 !水母 !小丑魚 換魚種|{顏色} 粉、{顏色} 彩虹、{顏色} #66ccff 換顏色|{跳} {衝} {轉} {睡} {泡泡} 做動作|{餵} 自己吃、{餵} @名字 請別人吃、{餵} 大家 全場吃|{頭像} 加一個表情符號，把它放到魚身上|{戴} 皇冠、{花紋} 星星、{副色} 藍、{配件色} 粉 打扮自己的魚|{表情} 開心、{大小} 大、{名牌} 粉|{抱} @名字 抱抱、{跟} @名字 跟著游|稀有魚種 !鯨魚 !獨角鯨 !錦鯉：{稀有}' },
  ];
  const SETTING = Object.fromEntries(SETTINGS.map((x) => [x.k, x]));
  // 網址參數 → 設定值（不合法或沒給就用預設）
  function readSetting(x, raw) {
    if (raw === null || raw === undefined) return x.type === 'multi' ? x.def.split(',') : x.def;
    if (x.type === 'color') return hex6(raw) || (x.empty !== undefined && raw === '' ? '' : x.def);
    if (x.type === 'range' || x.type === 'number') { const n = parseFloat(raw); return Number.isFinite(n) ? Math.min(x.max, Math.max(x.min, n)) : x.def; }
    if (x.type === 'select') return x.options[raw] ? raw : x.def;
    if (x.type === 'check') return !['0', 'false', 'off', 'no'].includes(raw);
    if (x.type === 'multi') return raw.split(',').filter((v) => x.options[v]);
    return String(raw).slice(0, x.type === 'lines' ? 2000 : 200);
  }
  // 設定值 → 網址參數（跟預設一樣就不寫，網址比較短）
  function writeSetting(x, v) {
    const def = x.type === 'multi' ? x.def : x.def;
    const out = x.type === 'multi' ? v.join(',') : x.type === 'check' ? (v ? '1' : '0') : String(v);
    const d = x.type === 'check' ? (def ? '1' : '0') : String(def);
    return out === d ? null : out;
  }
  // 文字樣板：{名字} → vars.名字
  const fillText = (t, vars = {}) => String(t || '').replace(/\{([^{}]+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  const pickLine = (lines, rnd = Math.random) => { const l = String(lines || '').split('|').map((x) => x.trim()).filter(Boolean); return l.length ? l[Math.floor(rnd() * l.length)] : ''; };

  // ── 開台中即時同步：設定頁送出的訊息都用只有 OBS 網址知道的暗號簽章（HMAC），別人送的假訊息會被丟掉 ──
  const SIG_WINDOW_MS = 5 * 60 * 1000;
  const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) || null;
  const enc = (t) => new TextEncoder().encode(t);
  const hexOf = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {}) : v);
  const canonical = (msg) => { const { sig, ...rest } = msg; void sig; return JSON.stringify(sortKeys(rest)); };
  async function hmac(secret, text) {
    const key = await subtle().importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hexOf(await subtle().sign('HMAC', key, enc(text)));
  }
  async function signMessage(secret, msg) {
    const body = { ...msg, ts: msg.ts || Date.now() };
    return { ...body, sig: await hmac(secret, canonical(body)) };
  }
  async function verifyMessage(secret, msg, now = Date.now()) {
    if (!msg || typeof msg.sig !== 'string' || typeof msg.ts !== 'number' || !secret) return false;
    if (Math.abs(now - msg.ts) > SIG_WINDOW_MS) return false;
    const expected = await hmac(secret, canonical(msg));
    if (expected.length !== msg.sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ msg.sig.charCodeAt(i);
    return diff === 0;
  }
  // 即時同步不送的參數：暗號、試算表（公開的中繼伺服器上別人可能看得到內容）
  const PRIVATE_PARAMS = ['room', 'key', 'store', 'skey', 'demo', 'edit'];

  // OBS 網址參數 → 設定
  const DEFAULTS = {
    channel: '',
    auto: true, // 在聊天室講話就自動變成魚（不用打 !魚）
    say: true, // 魚頭上顯示聊天內容
    bg: 'tank', // tank：完整水族箱背景 / none：透明，只畫魚和泡泡
    // 水族箱範圍：上下左右各留白畫面的幾成（0～0.9）。都是 0 就是全畫面；不是全畫面時，完整背景模式會畫成一個玻璃魚缸
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    max: 60, // 最多幾隻魚，滿了就請最久沒講話的離開
    idle: 20, // 幾分鐘沒講話就游走
    scale: 1, // 魚的大小倍率
    tip: true, // 底部輪播指令提示
    ignore: 'nightbot,streamelements,moobot,fossabot,streamlabs,wizebot,sery_bot',
    demo: false, // 顯示測試面板
    bits: 100, // 一次贊助幾個小奇點以上解鎖稀有魚種（0 = 關）
    subs: true, // 訂閱、續訂、被送訂閱就解鎖稀有魚種
    rw: '', // 忠誠點品項對應的動作（只認得「需要觀眾輸入文字」的品項）
    event: 15, // 每幾分鐘隨機來一次大事件（0 = 關）
    deco: 'chest,coral,bubbler', // 魚缸裝飾
    store: '', // Google 試算表（Apps Script 網頁應用程式）網址，換電腦也記得每隻魚
    skey: '', // 試算表暗號
    pfp: true, // 觀眾可以用 !頭像 大頭貼 把 Twitch 大頭貼放到魚身上
    weed: 1, // 海草多寡：0 沒有、1 一般（原本的量）、2 多、3 很多
    submit: true, // 觀眾可以用 !我的魚 圖片網址 提交自己的魚，管理員 !tank ok @名字 核准後才顯示
  };
  function readOptions(search) {
    const p = new URLSearchParams(search || '');
    const bool = (k) => (p.has(k) ? !['0', 'false', 'off', 'no'].includes(p.get(k)) : DEFAULTS[k]);
    const num = (k, lo, hi) => {
      const v = parseFloat(p.get(k));
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
    };
    const o = {
      channel: (p.get('channel') || '').trim().replace(/^#/, '').toLowerCase(),
      auto: bool('auto'),
      say: bool('say'),
      bg: p.get('bg') === 'none' || p.get('bg') === '0' ? 'none' : 'tank',
      ...fitArea(num('top', 0, 0.9), num('bottom', 0, 0.9), num('left', 0, 0.9), num('right', 0, 0.9)),
      max: Math.round(num('max', 1, 200)),
      idle: num('idle', 1, 240),
      scale: num('scale', 0.4, 3),
      tip: bool('tip'),
      ignore: (p.get('ignore') ?? DEFAULTS.ignore).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean),
      demo: bool('demo'),
      bits: Math.round(num('bits', 0, 100000)),
      subs: bool('subs'),
      rewards: parseRewards(p.get('rw') || ''),
      event: num('event', 0, 240),
      deco: (p.get('deco') ?? DEFAULTS.deco).split(',').map((s) => s.trim()).filter((d) => DECOS[d]),
      store: /^https:\/\/script\.google(usercontent)?\.com\//.test(p.get('store') || '') ? p.get('store') : '',
      skey: p.get('skey') || '',
      skins: parseSkins(p.getAll('skin')),
      pfp: bool('pfp'),
      theme: resolveTheme(p.get('theme'), p.get('water'), p.get('sand'), { air: p.get('air'), rock: p.get('rock'), weed: p.get('weedc'), ray: p.get('ray'), line: p.get('line') }),
      themeId: THEMES[p.get('theme')] ? p.get('theme') : 'ocean',
      hide: (p.get('hide') || '').split(',').map((x) => x.trim()).filter((x) => LAYERS[x]),
      weed: Math.round(num('weed', 0, 3)),
      bgimg: /^https:\/\//.test(p.get('bgimg') || '') ? p.get('bgimg') : '',
      submit: bool('submit'),
      objimgs: p.getAll('oimg').filter((u) => IMAGE_URL.test(u)).slice(0, 10),
    };
    o.objects = p.has('objs') ? parseObjects(p.get('objs'), o.objimgs.length) : decoToObjects(o.deco);
    o.ui = Object.fromEntries(SETTINGS.map((x) => [x.k, readSetting(x, p.get(x.k))]));
    o.words = {};
    for (const cmd of Object.keys(CMD_INFO)) { const w = splitWords(p.get('c_' + cmd)); if (w.length) o.words[cmd] = w; }
    o.off = (p.get('off') || '').split(',').filter((c) => CMD_INFO[c]);
    o.aliases = buildAliases(o.words, o.off);
    o.room = /^[A-Za-z0-9]{6,24}$/.test(p.get('room') || '') ? p.get('room') : '';
    o.key = p.get('key') || '';
    o.t = +p.get('t') || 0;
    o.edit = p.get('edit') === '1';
    return o;
  }

  // 用名字算出固定的預設魚種，同一個人每次進來都一樣
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function defaultSpecies(login) {
    const common = ['goldfish', 'clown', 'puffer', 'angel', 'jelly']; // 鯊魚要自己換
    return common[hashStr(login) % common.length];
  }

  return { SPECIES, SPECIES_IDS, RARE_IDS, EVENTS, REWARD_ACTIONS, DECOS, parseRewards, stringifyRewards, pickRare, CMD_INFO, buildAliases, splitWords, FONTS, SETTINGS, SETTING, readSetting, writeSetting, fillText, pickLine, signMessage, verifyMessage, PRIVATE_PARAMS, fitArea, parseSkins, firstEmote, emoteUrl, EVERYONE, THEMES, LAYERS, resolveTheme, mixHex, hex6, WEARS, PATTERNS, findWear, findPattern, IMAGE_URL, EXPRESSIONS, SIZES, findExpression, findSize, OFF, OBJECT_IDS, parseObjects, stringifyObjects, decoToObjects, COLORS, COMMANDS, COOLDOWN, DEFAULTS, findSpecies, findColor, parseCommand, cooldownOk, parseIrc, badgesOf, noticeOf, readOptions, defaultSpecies, hashStr };
});
