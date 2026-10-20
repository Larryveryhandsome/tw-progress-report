/*
 * tw-progress-report 彙報核心（純函式，不碰畫面）
 * 瀏覽器：window.Report；Node：require('./report.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Report = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 預設值 ----------
  const DEFAULT_STATUSES = [
    { key: 'todo', label: '未開始', icon: '○', color: '#6b7280' },
    { key: 'doing', label: '進行中', icon: '◐', color: '#2563eb' },
    { key: 'blocked', label: '卡關', icon: '⚠', color: '#dc2626' },
    { key: 'done', label: '完成', icon: '✔', color: '#16a34a', done: true },
  ];
  const DEFAULT_PRIORITIES = [
    { key: 'high', label: '高' },
    { key: 'normal', label: '中' },
    { key: 'low', label: '低' },
  ];
  // 常見寫法 → 狀態 key（舊資料常寫「⚙️ 進行中」「已完成」）
  const STATUS_ALIASES = {
    todo: ['未開始', '待處理', '待辦', '尚未開始', 'todo', 'not started'],
    doing: ['進行中', '處理中', '執行中', '跟進中', 'doing', 'in progress', 'wip'],
    blocked: ['卡關', '卡住', '暫停', '受阻', 'blocked', 'stuck'],
    done: ['完成', '已完成', '結案', '已結案', 'done', 'finished', 'ok'],
  };

  /** 各區塊的欄位定義（編輯表單、驗證、LINE 文字都用這份） */
  const SECTIONS = [
    {
      key: 'progress', label: '工作進度', nameField: 'item', hasStatus: true, dueField: 'due',
      fields: [
        { key: 'item', label: '項目', type: 'text', required: true },
        { key: 'status', label: '狀態', type: 'status' },
        { key: 'owner', label: '負責人', type: 'text' },
        { key: 'due', label: '預計完成', type: 'date' },
        { key: 'priority', label: '優先度', type: 'priority' },
        { key: 'note', label: '說明', type: 'textarea' },
      ],
    },
    {
      key: 'todos', label: '待辦事項', nameField: 'task', hasStatus: true, dueField: 'due',
      fields: [
        { key: 'task', label: '待辦', type: 'text', required: true },
        { key: 'status', label: '狀態', type: 'status' },
        { key: 'owner', label: '負責人', type: 'text' },
        { key: 'due', label: '期限', type: 'date' },
        { key: 'priority', label: '優先度', type: 'priority' },
        { key: 'note', label: '說明', type: 'textarea' },
      ],
    },
    {
      key: 'plans', label: '下期計畫', nameField: 'plan', dueField: 'due',
      fields: [
        { key: 'plan', label: '計畫', type: 'text', required: true },
        { key: 'owner', label: '負責人', type: 'text' },
        { key: 'due', label: '預計日期', type: 'date' },
        { key: 'details', label: '內容', type: 'textarea' },
      ],
    },
    {
      key: 'completed', label: '本期完成', nameField: 'item',
      fields: [
        { key: 'item', label: '完成事項', type: 'text', required: true },
        { key: 'date', label: '完成日', type: 'date' },
        { key: 'owner', label: '負責人', type: 'text' },
        { key: 'note', label: '說明', type: 'textarea' },
      ],
    },
    {
      key: 'clients', label: '客戶追蹤', nameField: 'client', dueField: 'next', isClient: true,
      fields: [
        { key: 'client', label: '客戶（原則上只寫姓氏＋稱謂）', type: 'text', required: true },
        { key: 'owner', label: '負責人', type: 'text' },
        { key: 'stage', label: '階段', type: 'text', placeholder: '例如：初次來訪、二次帶看、議價、簽約' },
        { key: 'next', label: '下次跟進日', type: 'date' },
        { key: 'progress', label: '追蹤狀況', type: 'textarea' },
      ],
    },
  ];
  const SECTION_KEYS = SECTIONS.map(s => s.key);
  const sectionOf = key => SECTIONS.find(s => s.key === key);

  function statusesOf(cfg) {
    return (cfg && Array.isArray(cfg.statuses) && cfg.statuses.length) ? cfg.statuses : DEFAULT_STATUSES;
  }
  function prioritiesOf(cfg) {
    return (cfg && Array.isArray(cfg.priorities) && cfg.priorities.length) ? cfg.priorities : DEFAULT_PRIORITIES;
  }
  /** 哪些狀態算「完成」：有 done:true 的；都沒標就用 key 為 done 的 */
  function doneKeys(cfg) {
    const st = statusesOf(cfg);
    const k = st.filter(s => s.done).map(s => s.key);
    return k.length ? k : st.filter(s => s.key === 'done').map(s => s.key);
  }

  // ---------- 小工具 ----------
  const str = v => (v == null ? '' : String(v)).trim();

  /** HTML 跳脫：任何使用者文字放進 HTML 前都要過這個 */
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let seq = 0;
  function uid() {
    seq = (seq + 1) % 1e6;
    return Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- 日期（一律用 'YYYY-MM-DD' 字串，避開時區） ----------
  function validYMD(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= days;
  }
  const pad = n => String(n).padStart(2, '0');

  /**
   * 讀日期，回傳 'YYYY-MM-DD'；讀不懂回傳 ''。
   * 支援 2026-10-05、2026/10/5、2026.10.5、2026年10月5日、民國 115/10/05、115年10月5日。
   */
  function parseDate(v) {
    const s = str(v).replace(/\s+/g, '');
    if (!s) return '';
    const m = s.match(/^(\d{2,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    if (!m) return '';
    let y = +m[1];
    const mo = +m[2], d = +m[3];
    if (m[1].length <= 3) y += 1911; // 民國年
    return validYMD(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '';
  }

  function addDays(ymd, n) {
    const p = parseDate(ymd);
    if (!p) return '';
    const [y, m, d] = p.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }

  /** 今天（本機時間） */
  function today(now) {
    const t = now || new Date();
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }

  /** 顯示用：2026-10-05 → 10/5；跨年時顯示年份 */
  function shortDate(ymd, withYear) {
    const p = parseDate(ymd);
    if (!p) return '';
    const [y, m, d] = p.split('-').map(Number);
    return (withYear ? y + '/' : '') + m + '/' + d;
  }

  /** 舊資料的「2025年4月2日 - 4月4日」或「2026-10-05 ~ 2026-10-11」→ {start, end} */
  function parseDateRange(text) {
    const s = str(text).replace(/\s+/g, '');
    if (!s) return { start: '', end: '' };
    // 抓出所有日期片段，第一個是開始、最後一個是結束（後面的可省略年份）
    const re = /(?:(\d{2,4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?/g;
    const found = [];
    let m;
    while ((m = re.exec(s))) found.push(m);
    if (!found.length) return { start: '', end: '' };
    const y0 = found[0][1];
    const mk = (mm, year) => parseDate(`${year}-${mm[2]}-${mm[3]}`);
    const year = y0 ? (y0.length <= 3 ? +y0 + 1911 : +y0) : new Date().getFullYear();
    const start = mk(found[0], year);
    let end = start;
    if (found.length > 1) {
      const f = found[found.length - 1];
      const y1 = f[1] ? (f[1].length <= 3 ? +f[1] + 1911 : +f[1]) : year;
      end = mk(f, y1);
      if (end && start && end < start && !f[1]) end = mk(f, y1 + 1); // 12/30 - 1/2 跨年
    }
    return { start: start || '', end: end || start || '' };
  }

  /** 期間文字：2026/10/5 – 10/11 */
  function periodLabel(p) {
    if (!p) return '';
    if (p.title) return p.title;
    if (!p.start && !p.end) return '（未填日期）';
    if (!p.end || p.end === p.start) return shortDate(p.start || p.end, true);
    const sameYear = p.start.slice(0, 4) === p.end.slice(0, 4);
    return `${shortDate(p.start, true)} – ${shortDate(p.end, !sameYear)}`;
  }

  // ---------- 狀態／優先度 ----------
  /** 把各種寫法的狀態轉成設定裡的 key；讀不懂回傳 null */
  function matchStatus(v, cfg) {
    const s = str(v);
    if (!s) return null;
    const st = statusesOf(cfg);
    const low = s.toLowerCase();
    let hit = st.find(x => x.key.toLowerCase() === low || str(x.label) === s);
    if (hit) return hit.key;
    // 「⚙️ 進行中」這種：去掉圖示後比對
    const bare = s.replace(/[^\p{L}\p{N}\s]/gu, '').trim().toLowerCase();
    hit = st.find(x => str(x.label).toLowerCase() === bare);
    if (hit) return hit.key;
    for (const [key, words] of Object.entries(STATUS_ALIASES)) {
      if (!st.some(x => x.key === key)) continue;
      if (words.some(w => w.toLowerCase() === bare)) return key;
    }
    // 最後：包含某個狀態名稱（越長越優先，避免「未完成」被當成「完成」）
    if (/未|尚未|沒/.test(bare)) {
      const t = st.find(x => x.key === 'todo') || st[0];
      if (/完成/.test(bare)) return t.key;
    }
    const sorted = st.slice().sort((a, b) => str(b.label).length - str(a.label).length);
    hit = sorted.find(x => x.label && bare.includes(str(x.label).toLowerCase()));
    return hit ? hit.key : null;
  }
  function statusInfo(key, cfg) {
    const st = statusesOf(cfg);
    return st.find(s => s.key === key) || { key, label: key || '—', icon: '', color: '#6b7280' };
  }
  function matchPriority(v, cfg) {
    const s = str(v).toLowerCase();
    if (!s) return '';
    const pr = prioritiesOf(cfg);
    const hit = pr.find(p => p.key.toLowerCase() === s || str(p.label).toLowerCase() === s);
    if (hit) return hit.key;
    if (/^(高|急|緊急|high|urgent|h|1)$/.test(s)) return pr.some(p => p.key === 'high') ? 'high' : '';
    if (/^(中|普通|一般|normal|medium|m|2)$/.test(s)) return pr.some(p => p.key === 'normal') ? 'normal' : '';
    if (/^(低|low|l|3)$/.test(s)) return pr.some(p => p.key === 'low') ? 'low' : '';
    return '';
  }
  function priorityLabel(key, cfg) {
    const hit = prioritiesOf(cfg).find(p => p.key === key);
    return hit ? hit.label : '';
  }

  // ---------- 驗證／整理資料 ----------
  /**
   * 把任何來源的資料整理成標準格式：{ project?, team?, periods: [...] }（新到舊）
   * 也吃舊版格式 { reports: [{dateRange, progress, todos, plans}], completed, clients }。
   * 回傳 { data, warnings }，warnings 是給人看的中文提醒；不會丟例外。
   */
  function normalize(raw, cfg) {
    const warnings = [];
    let src = raw;
    if (typeof src === 'string') {
      try { src = JSON.parse(src); } catch (e) { return { data: { periods: [] }, warnings: ['JSON 格式錯誤，無法讀取：' + e.message], parseError: true }; }
    }
    if (Array.isArray(src)) src = { periods: src };
    if (!src || typeof src !== 'object') return { data: { periods: [] }, warnings: ['資料不是物件，已改用空白資料'] };

    let periodsRaw = Array.isArray(src.periods) ? src.periods : null;
    if (!periodsRaw && Array.isArray(src.reports)) {
      // 舊版：completed / clients 放在最外層 → 併到最新一期
      periodsRaw = src.reports.map(r => Object.assign({}, r));
      if (periodsRaw.length && (Array.isArray(src.completed) || Array.isArray(src.clients))) {
        warnings.push('舊版格式：最外層的「本期完成」「客戶追蹤」已併到最新一期');
      }
    }
    if (!periodsRaw) { periodsRaw = []; warnings.push('找不到 periods（期別）陣列，已改用空白資料'); }

    const periods = periodsRaw.map((p, i) => normalizePeriod(p, cfg, warnings, i + 1)).filter(Boolean);

    if (!Array.isArray(src.periods) && Array.isArray(src.reports) && periods.length) {
      const newest = sortPeriods(periods)[0];
      for (const key of ['completed', 'clients']) {
        if (Array.isArray(src[key])) {
          newest[key] = newest[key].concat(normalizeItems(src[key], sectionOf(key), cfg, warnings, periodLabel(newest)));
        }
      }
    }

    const data = { periods: sortPeriods(periods) };
    if (str(src.project)) data.project = str(src.project);
    if (str(src.team)) data.team = str(src.team);
    // 同一期日期重複只提醒，不刪
    const seen = new Set();
    for (const p of data.periods) {
      const k = p.start + '|' + p.end;
      if (p.start && seen.has(k)) warnings.push(`有兩期日期相同（${periodLabel(p)}），請確認是否重複`);
      seen.add(k);
    }
    return { data, warnings };
  }

  function normalizePeriod(p, cfg, warnings, n) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) { warnings.push(`第 ${n} 期不是物件，已略過`); return null; }
    let start = parseDate(p.start), end = parseDate(p.end);
    if ((!start && !end) && p.dateRange) ({ start, end } = parseDateRange(p.dateRange));
    if (str(p.start) && !start) warnings.push(`第 ${n} 期開始日「${str(p.start)}」看不懂，已清空`);
    if (str(p.end) && !end) warnings.push(`第 ${n} 期結束日「${str(p.end)}」看不懂，已清空`);
    if (!start && end) start = end;
    if (start && !end) end = start;
    if (start && end && end < start) { warnings.push(`第 ${n} 期結束日早於開始日，已對調`); [start, end] = [end, start]; }
    if (!start) warnings.push(`第 ${n} 期沒有日期`);
    const out = {
      id: str(p.id) || uid(),
      start, end,
      title: str(p.title),
      summary: str(p.summary),
    };
    const label = periodLabel(out) || `第 ${n} 期`;
    for (const sec of SECTIONS) {
      const arr = p[sec.key];
      if (arr != null && !Array.isArray(arr)) warnings.push(`${label}「${sec.label}」不是陣列，已略過`);
      out[sec.key] = Array.isArray(arr) ? normalizeItems(arr, sec, cfg, warnings, label) : [];
    }
    return out;
  }

  // 舊版欄位名稱 → 新欄位
  const LEGACY = { person: 'owner', 負責人: 'owner' };

  function normalizeItems(arr, sec, cfg, warnings, label) {
    const out = [];
    arr.forEach((it, i) => {
      if (typeof it === 'string') it = { [sec.nameField]: it };
      if (!it || typeof it !== 'object') { warnings.push(`${label}「${sec.label}」第 ${i + 1} 筆格式錯誤，已略過`); return; }
      const o = { id: str(it.id) || uid() };
      const src = Object.assign({}, it);
      for (const [a, b] of Object.entries(LEGACY)) if (src[b] == null && src[a] != null) src[b] = src[a];
      // 舊版客戶的 progress 欄、待辦的 progress 欄 → 說明
      if (sec.key === 'todos' && src.note == null && src.progress != null) src.note = src.progress;
      for (const f of sec.fields) {
        const v = src[f.key];
        if (f.type === 'date') {
          const d = parseDate(v);
          if (str(v) && !d) {
            warnings.push(`${label}「${sec.label}」第 ${i + 1} 筆的${f.label}「${str(v)}」看不懂，已移到說明`);
            const noteKey = sec.fields.find(x => x.type === 'textarea');
            if (noteKey) src[noteKey.key] = [str(src[noteKey.key]), `（${f.label}：${str(v)}）`].filter(Boolean).join(' ');
          }
          o[f.key] = d;
        } else if (f.type === 'status') {
          const k = matchStatus(v, cfg);
          if (str(v) && !k) warnings.push(`${label}「${sec.label}」第 ${i + 1} 筆的狀態「${str(v)}」不在設定裡，改成「${statusesOf(cfg)[0].label}」`);
          o[f.key] = k || statusesOf(cfg)[0].key;
        } else if (f.type === 'priority') {
          o[f.key] = matchPriority(v, cfg);
        } else {
          o[f.key] = str(v);
        }
      }
      // 待辦的 note 可能在上面才被補
      for (const f of sec.fields) if (f.type === 'textarea' && !o[f.key] && str(src[f.key])) o[f.key] = str(src[f.key]);
      if (!o[sec.nameField]) { warnings.push(`${label}「${sec.label}」第 ${i + 1} 筆沒有${sec.fields[0].label}，已略過`); return; }
      out.push(o);
    });
    return out;
  }

  /** 新到舊（依結束日、再依開始日）；沒日期的放最後 */
  function sortPeriods(periods) {
    return periods.slice().sort((a, b) => {
      const ka = a.end || a.start || '', kb = b.end || b.start || '';
      if (ka !== kb) return ka < kb ? 1 : -1;
      const sa = a.start || '', sb = b.start || '';
      return sa === sb ? 0 : (sa < sb ? 1 : -1);
    });
  }

  // ---------- 統計 ----------
  function isDone(item, cfg) { return doneKeys(cfg).includes(item.status); }

  /** 逾期：沒完成、有期限、期限早於基準日（預設是該期結束日） */
  function isOverdue(item, sec, asOf, cfg) {
    const s = typeof sec === 'string' ? sectionOf(sec) : sec;
    if (!s || !s.dueField || !asOf) return false;
    const due = item[s.dueField];
    if (!due) return false;
    if (s.hasStatus && isDone(item, cfg)) return false;
    return due < asOf;
  }

  /**
   * 一期的統計：工作進度＋待辦的狀態分布、完成率、逾期數。
   * asOf 預設是該期結束日（彙報當下的角度）。
   */
  function computeStats(period, cfg, asOf) {
    const st = statusesOf(cfg);
    const byStatus = Object.fromEntries(st.map(s => [s.key, 0]));
    const at = asOf || (period && period.end) || '';
    let total = 0, done = 0, overdue = 0, high = 0;
    const overdueItems = [];
    for (const key of ['progress', 'todos']) {
      for (const it of (period && period[key]) || []) {
        total++;
        byStatus[it.status] = (byStatus[it.status] || 0) + 1;
        if (isDone(it, cfg)) done++;
        else if (it.priority === 'high') high++;
        if (isOverdue(it, key, at, cfg)) { overdue++; overdueItems.push({ section: key, item: it }); }
      }
    }
    const clientsDue = ((period && period.clients) || []).filter(c => isOverdue(c, 'clients', at, cfg)).length;
    return {
      total, done, overdue, overdueItems, highOpen: high, clientsDue,
      byStatus,
      completionRate: total ? done / total : 0,
      completed: ((period && period.completed) || []).length,
      clients: ((period && period.clients) || []).length,
      asOf: at,
    };
  }

  // ---------- 本期 vs 上期 ----------
  const nameKey = s => str(s).replace(/\s+/g, '').toLowerCase();

  /**
   * 比較兩期：新增、移除、搬區塊（例如計畫轉待辦）、狀態變化、本期新完成、客戶階段變化。
   * 用「項目名稱」對應（不分大小寫、忽略空白），工作進度／待辦／計畫視為同一池。
   * 上期已完成、本期拿掉的項目不算「移除」。prev 沒有時回傳 null。
   */
  function diffPeriods(cur, prev, cfg) {
    if (!cur || !prev) return null;
    const res = { added: [], removed: [], moved: [], statusChanged: [], newlyDone: [], clientChanged: [], clientAdded: [], clientRemoved: [] };
    const pool = p => {
      const m = new Map();
      for (const key of ['progress', 'todos', 'plans']) {
        const sec = sectionOf(key);
        for (const it of p[key] || []) {
          const k = nameKey(it[sec.nameField]);
          if (k && !m.has(k)) m.set(k, { section: key, sec, item: it, name: it[sec.nameField] });
        }
      }
      return m;
    };
    const before = pool(prev), after = pool(cur);
    const curCompleted = new Set((cur.completed || []).map(c => nameKey(c.item)));
    const wasDone = e => e.sec.hasStatus && isDone(e.item, cfg);

    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) { res.added.push({ section: a.section, name: a.name, item: a.item }); continue; }
      if (b.section !== a.section) res.moved.push({ name: a.name, from: b.section, to: a.section });
      const nowDone = a.sec.hasStatus && isDone(a.item, cfg);
      if (a.sec.hasStatus && b.sec.hasStatus && b.item.status !== a.item.status) {
        res.statusChanged.push({ section: a.section, name: a.name, from: b.item.status, to: a.item.status });
      }
      if (nowDone && !wasDone(b)) res.newlyDone.push({ section: a.section, name: a.name });
    }
    for (const [k, b] of before) {
      if (after.has(k)) continue;
      if (curCompleted.has(k)) { if (!wasDone(b)) res.newlyDone.push({ section: b.section, name: b.name }); }
      else if (!wasDone(b)) res.removed.push({ section: b.section, name: b.name, item: b.item });
    }

    const cb = new Map((prev.clients || []).map(c => [nameKey(c.client), c]));
    const ca = new Map((cur.clients || []).map(c => [nameKey(c.client), c]));
    for (const [k, c] of ca) {
      const old = cb.get(k);
      if (!old) res.clientAdded.push({ name: c.client, item: c });
      else if (str(old.stage) !== str(c.stage)) res.clientChanged.push({ name: c.client, from: old.stage, to: c.stage });
    }
    for (const [k, c] of cb) if (!ca.has(k)) res.clientRemoved.push({ name: c.client, item: c });

    const changedNames = new Set(res.statusChanged.map(s => nameKey(s.name)));
    res.count = res.added.length + res.removed.length + res.moved.length + res.statusChanged.length +
      res.clientChanged.length + res.clientAdded.length + res.clientRemoved.length +
      res.newlyDone.filter(d => !changedNames.has(nameKey(d.name))).length;
    return res;
  }

  // ---------- 個資遮蔽 ----------
  const COMPOUND_SURNAMES = ['歐陽', '司馬', '上官', '諸葛', '東方', '皇甫', '尉遲', '公孫', '慕容', '長孫', '令狐', '司徒', '夏侯', '張簡', '范姜', '鍾離', '端木', '西門', '南宮'];
  const TITLES = ['先生', '小姐', '太太', '女士', '媽媽', '爸爸', '阿姨', '伯伯', '老師', '夫婦', '一家'];
  const MASK = '○○';

  /**
   * 客戶姓名遮蔽。mode：
   *   'title'  （預設）有稱謂留「姓＋稱謂」：王大明先生 → 王先生；沒稱謂：王大明 → 王○○
   *   'circle' 一律「姓＋○○」：王先生 → 王○○
   *   'none'   不遮蔽（原則上不建議）
   * 前面的戶別代號會保留：A3-王大明 → A3-王○○
   */
  function maskName(name, mode) {
    const s = str(name);
    if (!s || mode === 'none' || mode === false) return s;
    // 「12樓-李小姐」：分隔符號後面是中文名字 → 前面整段當代號；否則只認「A3」這種含數字的代號
    const m = s.match(/^(.*[-_#:：\s])([㐀-鿿][^-_#:：\s]*)$/) ||
      s.match(/^([A-Za-z]*\d[A-Za-z0-9]*[-_#\s:：]*)?(.*)$/);
    const prefix = m[1] || '';
    const body = m[2].trim();
    if (!body) return s;
    if (!/^[㐀-鿿]/.test(body)) {
      // 英文或其他：只留第一個字母
      return prefix + body[0] + MASK;
    }
    const surname = COMPOUND_SURNAMES.find(c => body.startsWith(c) && body.length > c.length) || body[0];
    const title = TITLES.find(t => body.endsWith(t) && body.length > t.length);
    if ((mode == null || mode === 'title' || mode === true) && title) return prefix + surname + title;
    return prefix + surname + MASK;
  }

  /** 文字裡的手機號碼遮成 0900-***-***（原則上客戶電話不要寫進彙報） */
  function maskPhones(text) {
    return String(text == null ? '' : text)
      .replace(/(09\d{2})[-\s]?\d{3}[-\s]?\d{3}/g, '$1-***-***')
      .replace(/(\+?886)[-\s]?9(\d{2})[-\s]?\d{3}[-\s]?\d{3}/g, '$1-9$2-***-***');
  }

  function maskMode(cfg) {
    const m = cfg && cfg.maskClients;
    if (m === false || m === 'none') return 'none';
    if (m === 'circle') return 'circle';
    return 'title';
  }

  /** 客戶資料的顯示版本（名字遮蔽、文字裡的電話遮蔽） */
  function maskClient(c, cfg) {
    const mode = maskMode(cfg);
    if (mode === 'none') return Object.assign({}, c);
    return Object.assign({}, c, {
      client: maskName(c.client, mode),
      progress: maskPhones(c.progress),
      stage: maskPhones(c.stage),
    });
  }

  // ---------- 新增一期 ----------
  /**
   * 以上一期為底建立新的一期：
   *   - 工作進度、待辦：只帶入「沒完成」的
   *   - 上期的「下期計畫」轉成本期待辦（狀態＝第一個狀態）
   *   - 客戶追蹤：全部帶入
   *   - 本期完成：空白
   */
  function newPeriodFrom(prev, cfg, opts) {
    const o = opts || {};
    const len = prev && prev.start && prev.end ? Math.round((Date.parse(prev.end) - Date.parse(prev.start)) / 864e5) : 6;
    const start = parseDate(o.start) || (prev && prev.end ? addDays(prev.end, 1) : today());
    const end = parseDate(o.end) || addDays(start, len);
    const p = { id: uid(), start, end, title: str(o.title), summary: '', progress: [], todos: [], plans: [], completed: [], clients: [] };
    if (!prev || o.carry === false) return p;
    const copy = it => Object.assign({}, it, { id: uid() });
    p.progress = (prev.progress || []).filter(it => !isDone(it, cfg)).map(copy);
    p.todos = (prev.todos || []).filter(it => !isDone(it, cfg)).map(copy);
    const have = new Set(p.todos.map(t => nameKey(t.task)).concat(p.progress.map(t => nameKey(t.item))));
    for (const pl of prev.plans || []) {
      if (have.has(nameKey(pl.plan))) continue;
      p.todos.push({ id: uid(), task: pl.plan, status: statusesOf(cfg)[0].key, owner: pl.owner || '', due: pl.due || '', priority: '', note: pl.details || '' });
    }
    p.clients = (prev.clients || []).map(copy);
    return p;
  }

  // ---------- LINE 文字版 ----------
  /**
   * 產生可以直接貼到 LINE 的純文字。
   * opts: { prev（上一期，用來列「與上期相比」）, project, team, title, asOf }
   * 客戶一律依設定遮蔽。
   */
  function lineText(period, cfg, opts) {
    const o = opts || {};
    const c = cfg || {};
    if (!period) return '';
    const st = statusesOf(c);
    const stats = computeStats(period, c, o.asOf);
    const project = o.project || c.project || '';
    const title = o.title || c.title || '工作進度彙報';
    const team = o.team || c.team || '';
    const L = [];
    L.push(`【${[project, title].filter(Boolean).join(' ')}】`);
    L.push([team, periodLabel(period)].filter(Boolean).join('｜'));
    if (stats.total) {
      L.push(`完成率 ${Math.round(stats.completionRate * 100)}%（${stats.done}/${stats.total}）` +
        st.filter(s => !doneKeys(c).includes(s.key) && stats.byStatus[s.key]).map(s => `｜${s.label} ${stats.byStatus[s.key]}`).join('') +
        (stats.overdue ? `｜逾期 ${stats.overdue}` : ''));
    }
    if (period.summary) { L.push(''); L.push(period.summary); }

    const meta = (it, sec) => {
      const bits = [];
      if (it.owner) bits.push(it.owner);
      const due = sec.dueField && it[sec.dueField];
      if (due) bits.push((sec.key === 'clients' ? '下次 ' : '') + shortDate(due) + (isOverdue(it, sec, stats.asOf, c) ? '（逾期）' : ''));
      if (it.priority === 'high') bits.push('優先');
      return bits.length ? `（${bits.join('，')}）` : '';
    };

    for (const sec of SECTIONS) {
      let items = period[sec.key] || [];
      if (!items.length) continue;
      L.push('');
      L.push(`■ ${sec.label}${sec.isClient && maskMode(c) !== 'none' ? '（姓名已遮蔽）' : ''}`);
      if (sec.isClient) items = items.map(it => maskClient(it, c));
      items.forEach(it => {
        const head = sec.hasStatus ? `${statusInfo(it.status, c).icon || '・'} ` : '・';
        const tag = sec.hasStatus ? `［${statusInfo(it.status, c).label}］` : '';
        let line;
        if (sec.key === 'completed') line = `・${it.item}${it.date ? `（${shortDate(it.date)}）` : ''}${it.owner ? ` ${it.owner}` : ''}`;
        else if (sec.isClient) line = `・${it.client}${it.stage ? `［${it.stage}］` : ''}${meta(it, sec)}`;
        else line = `${head}${it[sec.nameField]}${tag}${meta(it, sec)}`;
        L.push(line);
        const note = it.note || it.details || it.progress;
        if (note) L.push(`　${note.replace(/\s*\n\s*/g, ' ')}`);
      });
    }

    if (o.prev) {
      const d = diffPeriods(period, o.prev, c);
      if (d && d.count) {
        L.push('');
        L.push(`■ 與上期（${periodLabel(o.prev)}）相比`);
        const lab = k => statusInfo(k, c).label;
        if (d.newlyDone.length) L.push(`・新完成：${d.newlyDone.map(x => x.name).join('、')}`);
        const changed = d.statusChanged.filter(x => !isDone({ status: x.to }, c));
        if (changed.length) L.push(`・狀態變化：${changed.map(x => `${x.name} ${lab(x.from)}→${lab(x.to)}`).join('、')}`);
        if (d.moved.length) L.push(`・轉區塊：${d.moved.map(x => `${x.name}（${sectionOf(x.from).label}→${sectionOf(x.to).label}）`).join('、')}`);
        if (d.added.length) L.push(`・新增：${d.added.map(x => x.name).join('、')}`);
        if (d.removed.length) L.push(`・移除：${d.removed.map(x => x.name).join('、')}`);
        const mm = n => maskName(n, maskMode(c));
        if (d.clientAdded.length) L.push(`・新客戶：${d.clientAdded.map(x => mm(x.name)).join('、')}`);
        if (d.clientChanged.length) L.push(`・客戶進展：${d.clientChanged.map(x => `${mm(x.name)} ${x.from || '—'}→${x.to || '—'}`).join('、')}`);
      }
    }
    return L.join('\n');
  }

  return {
    DEFAULT_STATUSES, DEFAULT_PRIORITIES, SECTIONS, SECTION_KEYS, sectionOf,
    statusesOf, prioritiesOf, doneKeys, statusInfo, matchStatus, matchPriority, priorityLabel,
    escapeHTML, uid,
    parseDate, parseDateRange, addDays, today, shortDate, periodLabel,
    normalize, sortPeriods, isDone, isOverdue, computeStats, diffPeriods,
    maskName, maskPhones, maskMode, maskClient,
    newPeriodFrom, lineText,
  };
});
