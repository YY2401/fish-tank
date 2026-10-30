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
    avatar: ['avatar', '頭像', '臉', 'face'],
    help: ['fishhelp', '魚說明', '水族箱'],
    tank: ['tank'], // 實況主／管理員專用：!tank clear、!tank feed、!tank shark…
  };
  const ALIAS = {};
  for (const [cmd, list] of Object.entries(COMMANDS)) for (const a of list) ALIAS[a.toLowerCase()] = cmd;
  // 直接打魚種名稱也能變身，例如 !鯊魚
  for (const [id, sp] of Object.entries(SPECIES)) for (const a of sp.aliases) if (!ALIAS[a.toLowerCase()]) ALIAS[a.toLowerCase()] = 'skin:' + id;

  // 各指令的個人冷卻（毫秒）
  const COOLDOWN = { jump: 4000, dash: 3000, spin: 4000, bubble: 3000, feed: 15000, hug: 8000, skin: 5000, color: 3000, help: 30000 };

  // 大事件與忠誠點品項可以觸發的動作
  const EVENTS = { shark: '鯊魚出沒', whirl: '大漩渦', treasure: '寶箱掉落', school: '魚群' };
  const REWARD_ACTIONS = { rare: '解鎖稀有魚種', shark: '鯊魚出沒', whirl: '大漩渦', treasure: '寶箱掉落', feed: '全場撒飼料' };
  const DECOS = { castle: '城堡', chest: '寶箱', coral: '珊瑚', bubbler: '打氣石' };

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
  function parseCommand(text, skins = []) {
    const m = String(text || '').trim().match(/^[!！]\s*(\S+)\s*(.*)$/);
    if (!m) return null;
    let cmd = ALIAS[m[1].toLowerCase()];
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
      if (!name || !/^https:\/\//.test(url) || out.some((k) => k.name === name)) continue;
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
  };
  function readOptions(search) {
    const p = new URLSearchParams(search || '');
    const bool = (k) => (p.has(k) ? !['0', 'false', 'off', 'no'].includes(p.get(k)) : DEFAULTS[k]);
    const num = (k, lo, hi) => {
      const v = parseFloat(p.get(k));
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
    };
    return {
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
    };
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

  return { SPECIES, SPECIES_IDS, RARE_IDS, EVENTS, REWARD_ACTIONS, DECOS, parseRewards, stringifyRewards, pickRare, fitArea, parseSkins, firstEmote, emoteUrl, EVERYONE, COLORS, COMMANDS, COOLDOWN, DEFAULTS, findSpecies, findColor, parseCommand, cooldownOk, parseIrc, badgesOf, noticeOf, readOptions, defaultSpecies, hashStr };
});
