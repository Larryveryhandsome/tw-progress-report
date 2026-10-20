/*
 * tw-progress-report 畫面邏輯
 * 所有使用者文字一律用 textContent 放進畫面（h() 幫手），不用任何 HTML 字串組畫面。
 */
(function () {
  'use strict';
  const R = window.Report;
  const CFG = window.REPORT_CONFIG || {};
  const KEY = (CFG.storageKey || 'tw-progress-report') + ':data';
  const PREF = (CFG.storageKey || 'tw-progress-report') + ':pref';
  const $ = id => document.getElementById(id);

  // ---------- DOM 幫手：文字一律走 textContent ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  // 顏色只接受 #RGB / #RRGGBB / 英文色名，避免設定檔塞奇怪的 CSS
  const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c)) || /^[a-z]+$/i.test(String(c))) ? String(c) : '#6b7280';

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------- 儲存（localStorage 失敗也要能用） ----------
  function readStore(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function writeStore(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function removeStore(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 無法使用就算了 */ } }

  let pref = {};
  try { pref = JSON.parse(readStore(PREF) || '{}') || {}; } catch (e) { pref = {}; }
  const savePref = () => writeStore(PREF, JSON.stringify(pref));

  let data = { periods: [] };
  let source = '';
  let idx = 0;
  let warnings = [];
  let noticeTitle = '資料有些地方已自動修正：';

  function load(raw, label) {
    const res = R.normalize(raw, CFG);
    data = res.data;
    warnings = res.warnings;
    noticeTitle = '資料有些地方已自動修正：';
    source = label;
    idx = 0;
  }
  function persist() {
    if (!writeStore(KEY, JSON.stringify(data))) {
      toast('儲存失敗：瀏覽器不能存資料（無痕模式或空間已滿），這次的變更沒有存下來！請立刻按「匯出 JSON」備份');
      return false;
    }
    source = '這台電腦存的資料';
    return true;
  }

  // ---------- 小東西 ----------
  const project = () => data.project || CFG.project || '';
  const team = () => data.team || CFG.team || '';
  const cur = () => data.periods[idx] || null;
  const prev = () => data.periods[idx + 1] || null;
  // 已知的客戶姓名（全部期別）：寫在別處（摘要、工作項目、說明）的全名也會被遮蔽
  const names = () => R.clientNames(data);
  const mt = s => R.maskText(s, CFG, names());
  const asOf = p => (CFG.overdueBase === 'today' ? R.today() : (p && p.end) || R.today());

  function badge(key) {
    const s = R.statusInfo(key, CFG);
    return h('span', { class: 'badge', style: { background: safeColor(s.color) } }, s.label);
  }

  // ---------- 畫面 ----------
  function render() {
    const title = [project(), CFG.title || '工作進度彙報'].filter(Boolean).join(' ');
    document.title = title;
    $('title').textContent = title;
    const p = cur();
    $('subtitle').textContent = [team(), p ? R.periodLabel(p) : ''].filter(Boolean).join('｜');

    // 期別選單
    const sel = clear($('periodSel'));
    data.periods.forEach((pp, i) => sel.appendChild(h('option', { value: i }, (i === 0 ? '最新：' : '') + R.periodLabel(pp))));
    sel.value = String(idx);
    sel.disabled = !data.periods.length;

    const editing = $('editMode').checked;
    document.body.classList.toggle('editing', editing);
    $('periodBar').hidden = !editing;
    $('btnEditPeriod').disabled = $('btnDelPeriod').disabled = !p;

    // 提醒
    const nt = $('notice');
    clear(nt);
    nt.hidden = !warnings.length;
    if (warnings.length) {
      nt.appendChild(h('b', null, noticeTitle));
      nt.appendChild(h('ul', null, warnings.slice(0, 8).map(w => h('li', null, w)),
        warnings.length > 8 ? h('li', null, `……還有 ${warnings.length - 8} 則`) : null));
    }

    renderOverview(p);
    renderDiff(p);
    renderSections(p, editing);
    $('dataInfo').textContent = `目前資料：${source}，共 ${data.periods.length} 期。`;
    $('btnLine').disabled = $('btnPrint').disabled = !p;
  }

  function renderOverview(p) {
    const box = clear($('overview'));
    if (!p) {
      box.appendChild(h('h2', null, '還沒有任何一期'));
      box.appendChild(h('p', { class: 'empty' }, '勾選右上角「編輯模式」，按「＋ 新增一期」開始寫第一份彙報；或展開最下面的「資料」匯入 JSON。'));
      return;
    }
    const s = R.computeStats(p, CFG, asOf(p));
    box.appendChild(h('h2', null, '本期總覽', h('span', { class: 'count' }, `（${R.periodLabel(p)}）`)));
    if (p.summary) box.appendChild(h('p', { class: 'summary-text' }, mt(p.summary)));
    box.appendChild(h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', null, s.total ? Math.round(s.completionRate * 100) + '%' : '—'), h('span', null, `完成率（${s.done}/${s.total}）`)),
      h('div', { class: 'kpi' + (s.overdue ? ' bad' : '') }, h('b', null, s.overdue), h('span', null, '逾期')),
      h('div', { class: 'kpi' + (s.byStatus.blocked ? ' bad' : '') }, h('b', null, s.byStatus.blocked || 0), h('span', null, R.statusInfo('blocked', CFG).label || '卡關')),
      h('div', { class: 'kpi' }, h('b', null, s.completed), h('span', null, '本期完成')),
      h('div', { class: 'kpi' + (s.clientsDue ? ' bad' : '') }, h('b', null, s.clients), h('span', null, s.clientsDue ? `追蹤客戶（${s.clientsDue} 位該聯絡）` : '追蹤客戶')),
    ));
    if (s.total) {
      const st = R.statusesOf(CFG);
      box.appendChild(h('div', { class: 'bar', role: 'img', 'aria-label': st.map(x => `${x.label} ${s.byStatus[x.key] || 0}`).join('，') },
        st.map(x => s.byStatus[x.key] ? h('i', { title: `${x.label} ${s.byStatus[x.key]}`, style: { width: (s.byStatus[x.key] / s.total * 100) + '%', background: safeColor(x.color) } }) : null)));
      box.appendChild(h('div', { class: 'legend' }, st.map(x => h('span', null, h('span', { class: 'dot', style: { background: safeColor(x.color) } }), `${x.label} ${s.byStatus[x.key] || 0}`))));
    }
    box.appendChild(h('p', { class: 'hint' }, `完成率與逾期只算「工作進度」和「待辦事項」；逾期以 ${R.shortDate(s.asOf, true)} 為基準。`));
  }

  function renderDiff(p) {
    const box = clear($('diff'));
    const pv = prev();
    box.hidden = !p;
    if (!p) return;
    box.appendChild(h('h2', null, '本期 vs 上期', pv ? h('span', { class: 'count' }, `（上期：${R.periodLabel(pv)}）`) : null));
    if (!pv) { box.appendChild(h('p', { class: 'empty' }, '這是最早的一期，沒有可以比較的上期。')); return; }
    const d = R.diffPeriods(p, pv, CFG);
    if (!d.count) { box.appendChild(h('p', { class: 'empty' }, '和上期相比沒有變化。')); return; }
    const lab = k => R.statusInfo(k, CFG).label;
    const secLab = k => R.sectionOf(k).label;
    const mm = n => R.maskMode(CFG) === 'none' ? n : R.maskName(n, R.maskMode(CFG));
    const nm = names();
    const mx = s => R.maskText(s, CFG, nm);
    const ul = h('ul', { class: 'diff' });
    const row = (k, ...c) => ul.appendChild(h('li', null, h('span', { class: 'k' }, k), ...c));
    if (d.newlyDone.length) row('新完成', h('span', { class: 'add' }, d.newlyDone.map(x => mx(x.name)).join('、')));
    const changed = d.statusChanged.filter(x => !R.isDone({ status: x.to }, CFG));
    if (changed.length) row('狀態變化', changed.map(x => `${mx(x.name)}：${lab(x.from)} → ${lab(x.to)}`).join('；'));
    if (d.moved.length) row('轉區塊', d.moved.map(x => `${mx(x.name)}（${secLab(x.from)} → ${secLab(x.to)}）`).join('；'));
    if (d.added.length) row('新增', h('span', { class: 'add' }, d.added.map(x => mx(x.name)).join('、')));
    if (d.removed.length) row('拿掉', h('span', { class: 'del' }, d.removed.map(x => mx(x.name)).join('、')), '（上期沒完成、本期沒列）');
    if (d.clientAdded.length) row('新客戶', d.clientAdded.map(x => mm(x.name)).join('、'));
    if (d.clientChanged.length) row('客戶進展', d.clientChanged.map(x => `${mm(x.name)}：${mx(x.from) || '—'} → ${mx(x.to) || '—'}`).join('；'));
    if (d.clientRemoved.length) row('不再追蹤', d.clientRemoved.map(x => mm(x.name)).join('、'));
    box.appendChild(ul);
  }

  function renderSections(p, editing) {
    const wrap = clear($('sections'));
    if (!p) return;
    const at = asOf(p);
    const mode = R.maskMode(CFG);
    const nm = names();
    for (const sec of R.SECTIONS) {
      const items = p[sec.key] || [];
      if (!items.length && !editing) continue;
      const card = h('section', { class: 'card' });
      card.appendChild(h('h2', null, sec.label, h('span', { class: 'count' }, `${items.length} 筆`),
        sec.isClient && mode !== 'none' ? h('span', { class: 'count' }, '・姓名已遮蔽') : null,
        h('span', { class: 'spacer' }),
        editing ? h('button', { type: 'button', class: 'mini no-print', onclick: () => openItem(sec, -1) }, '＋ 新增') : null));
      if (!items.length) { card.appendChild(h('p', { class: 'empty' }, '（沒有資料）')); wrap.appendChild(card); continue; }
      const ul = h('ul', { class: 'items' });
      items.forEach((raw, i) => {
        const it = R.maskItem(raw, sec, CFG, nm);
        const late = R.isOverdue(raw, sec, at, CFG);
        const meta = [];
        if (it.owner) meta.push(h('span', null, '👤 ' + it.owner));
        if (sec.key === 'completed' && it.date) meta.push(h('span', null, '完成 ' + R.shortDate(it.date)));
        if (sec.isClient && it.stage) meta.push(h('span', { class: 'tag' }, it.stage));
        const due = sec.dueField && it[sec.dueField];
        if (due) meta.push(h('span', { class: late ? 'tag late' : '' }, (sec.isClient ? '下次跟進 ' : '期限 ') + R.shortDate(due) + (late ? '・逾期' : '')));
        if (it.priority) meta.push(h('span', { class: 'tag' + (it.priority === 'high' ? ' high' : '') }, '優先 ' + R.priorityLabel(it.priority, CFG)));
        const note = it.note || it.details || it.progress;
        ul.appendChild(h('li', { class: 'item' + (late ? ' overdue' : '') },
          sec.hasStatus ? badge(it.status) : null,
          h('div', { class: 'main' },
            h('div', { class: 'name' }, it[sec.nameField]),
            meta.length ? h('div', { class: 'meta' }, meta) : null,
            note ? h('div', { class: 'note' }, note) : null),
          editing ? h('div', { class: 'ops no-print' },
            h('button', { type: 'button', class: 'mini', onclick: () => openItem(sec, i) }, '編輯'),
            h('button', { type: 'button', class: 'mini danger', onclick: () => delItem(sec, i) }, '刪除')) : null));
      });
      card.appendChild(ul);
      wrap.appendChild(card);
    }
  }

  // ---------- 編輯表單 ----------
  let onSave = null;
  function fieldInput(f, value) {
    const id = 'f_' + f.key;
    let input;
    if (f.type === 'textarea') input = h('textarea', { id, name: f.key, rows: 3 });
    else if (f.type === 'status') input = h('select', { id, name: f.key }, R.statusesOf(CFG).map(s => h('option', { value: s.key }, s.label)));
    else if (f.type === 'priority') input = h('select', { id, name: f.key }, h('option', { value: '' }, '（不設定）'), R.prioritiesOf(CFG).map(s => h('option', { value: s.key }, s.label)));
    else if (f.type === 'checkbox') input = h('input', { id, name: f.key, type: 'checkbox' });
    else input = h('input', { id, name: f.key, type: f.type === 'date' ? 'date' : 'text', placeholder: f.placeholder || null, autocomplete: 'off' });
    if (f.type === 'checkbox') input.checked = !!value;
    else input.value = value == null ? '' : value;
    if (f.type === 'checkbox') return h('label', { class: 'check', for: id }, input, f.label);
    return h('label', { for: id }, f.label + (f.required ? '（必填）' : ''), input);
  }
  function openForm(title, fields, values, save) {
    $('editTitle').textContent = title;
    const box = clear($('editFields'));
    fields.forEach(f => box.appendChild(fieldInput(f, values[f.key])));
    $('editErr').hidden = true;
    onSave = save;
    $('dlgEdit').showModal();
    const first = box.querySelector('input,textarea,select');
    if (first) first.focus();
  }
  $('editForm').addEventListener('submit', e => {
    e.preventDefault();
    const vals = {};
    for (const el of $('editFields').querySelectorAll('[name]')) vals[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    const err = onSave && onSave(vals);
    if (err) { $('editErr').textContent = err; $('editErr').hidden = false; return; }
    $('dlgEdit').close();
    persist();
    render();
  });
  $('editCancel').addEventListener('click', () => $('dlgEdit').close());

  function openItem(sec, i) {
    const p = cur();
    if (!p) return;
    const old = i >= 0 ? p[sec.key][i] : { status: R.statusesOf(CFG)[0].key };
    openForm(`${i >= 0 ? '編輯' : '新增'}：${sec.label}`, sec.fields, old, vals => {
      const missing = sec.fields.find(f => f.required && !vals[f.key]);
      if (missing) return `請填「${missing.label}」`;
      // 交給核心整理一次（日期、狀態格式）
      const fixed = R.normalize({ periods: [{ start: p.start, end: p.end, [sec.key]: [Object.assign({}, old, vals)] }] }, CFG).data.periods[0][sec.key][0];
      if (!fixed) return '資料格式不正確';
      if (i >= 0) { fixed.id = old.id; p[sec.key][i] = fixed; } else p[sec.key].push(fixed);
      return null;
    });
  }
  function delItem(sec, i) {
    const p = cur();
    const it = p[sec.key][i];
    if (!window.confirm(`確定刪除「${it[sec.nameField]}」？`)) return;
    p[sec.key].splice(i, 1);
    persist();
    render();
  }

  const PERIOD_FIELDS = [
    { key: 'start', label: '開始日', type: 'date', required: true },
    { key: 'end', label: '結束日', type: 'date', required: true },
    { key: 'title', label: '自訂標題（可空白，空白就顯示日期）', type: 'text' },
    { key: 'summary', label: '本期摘要', type: 'textarea' },
  ];
  function checkDates(v) {
    if (!R.parseDate(v.start) || !R.parseDate(v.end)) return '請填開始日和結束日';
    if (v.end < v.start) return '結束日不能早於開始日';
    return null;
  }
  $('btnNewPeriod').addEventListener('click', () => {
    const base = data.periods[0] || null;
    const draft = R.newPeriodFrom(base, CFG, {});
    const fields = PERIOD_FIELDS.concat(base ? [{ key: 'carry', label: '帶入上一期沒完成的進度／待辦、下期計畫（轉成待辦）、客戶追蹤', type: 'checkbox' }] : []);
    openForm('新增一期', fields, Object.assign({}, draft, { carry: true }), v => {
      const e = checkDates(v);
      if (e) return e;
      const p = R.newPeriodFrom(base, CFG, { start: v.start, end: v.end, title: v.title, carry: !!v.carry });
      p.summary = v.summary || '';
      data.periods = R.sortPeriods(data.periods.concat(p));
      idx = data.periods.indexOf(p);
      return null;
    });
  });
  $('btnEditPeriod').addEventListener('click', () => {
    const p = cur();
    if (!p) return;
    openForm('編輯本期', PERIOD_FIELDS, p, v => {
      const e = checkDates(v);
      if (e) return e;
      Object.assign(p, { start: R.parseDate(v.start), end: R.parseDate(v.end), title: v.title, summary: v.summary });
      data.periods = R.sortPeriods(data.periods);
      idx = data.periods.indexOf(p);
      return null;
    });
  });
  $('btnDelPeriod').addEventListener('click', () => {
    const p = cur();
    if (!p || !window.confirm(`確定刪除「${R.periodLabel(p)}」整期的資料？建議先匯出 JSON 備份。`)) return;
    data.periods.splice(idx, 1);
    idx = Math.min(idx, Math.max(0, data.periods.length - 1));
    persist();
    render();
  });

  // ---------- LINE 文字版 ----------
  $('btnLine').addEventListener('click', () => {
    const p = cur();
    if (!p) return;
    $('lineText').value = R.lineText(p, CFG, { prev: prev(), project: project(), team: team(), asOf: asOf(p), names: names() });
    const n = $('lineText').value.length;
    // LINE 單則文字訊息上限 5000 字，超過會送不出去
    $('lineMsg').textContent = n > 5000 ? `${n} 字，超過 LINE 單則 5000 字上限，請分兩則貼（或刪減內容）` : `${n} 字`;
    $('dlgLine').showModal();
  });
  $('lineClose').addEventListener('click', () => $('dlgLine').close());
  $('lineCopy').addEventListener('click', () => {
    const ta = $('lineText');
    const done = ok => { $('lineMsg').textContent = ok ? '已複製，可以貼到 LINE 了' : '無法自動複製，請長按文字框全選後複製'; };
    const fallback = () => {
      ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(ta.value).then(() => done(true), fallback);
    else fallback();
  });

  // ---------- 列印 ----------
  $('btnPrint').addEventListener('click', () => window.print());

  // ---------- 匯出／匯入 ----------
  $('btnExport').addEventListener('click', () => {
    const out = JSON.stringify(data, null, 2);
    const blob = new Blob([out], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `progress-report-${R.today()}.json` });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $('file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = R.normalize(String(r.result), CFG);
      if (!res.data.periods.length) { warnings = res.warnings; noticeTitle = res.parseError ? '匯入失敗，檔案不是正確的 JSON：' : '匯入失敗，檔案裡沒有可用的期別資料：'; render(); toast('檔案裡沒有可用的期別資料'); return; }
      if (data.periods.length && !window.confirm(`匯入「${f.name}」會取代目前的 ${data.periods.length} 期資料，確定？`)) return;
      load(String(r.result), f.name);
      persist();
      render();
      toast(`已匯入 ${data.periods.length} 期`);
    };
    r.readAsText(f, 'utf-8');
    e.target.value = '';
  });
  $('btnSample').addEventListener('click', () => {
    if (!window.confirm('改用示範資料會取代目前的資料（建議先匯出 JSON 備份），確定？')) return;
    removeStore(KEY);
    load(window.REPORT_DATA || { periods: [] }, '示範資料（全部是假的）');
    render();
  });
  $('btnClear').addEventListener('click', () => {
    if (!window.confirm('確定清除這台電腦存的彙報資料？（建議先匯出 JSON 備份）')) return;
    removeStore(KEY);
    load({ periods: [] }, '空白');
    warnings = [];
    render();
  });

  // ---------- 其他控制 ----------
  $('periodSel').addEventListener('change', e => { idx = +e.target.value || 0; render(); });
  $('editMode').addEventListener('change', e => { pref.edit = e.target.checked; savePref(); render(); });

  // 別的分頁改了資料 → 這頁重新讀入，避免兩個分頁互相用舊資料整份覆蓋
  window.addEventListener('storage', e => {
    if (e.key !== KEY || e.newValue == null) return;
    const keep = idx;
    load(e.newValue, '這台電腦存的資料');
    idx = Math.min(keep, Math.max(0, data.periods.length - 1));
    render();
  });

  // ---------- 啟動 ----------
  const saved = readStore(KEY);
  // 存的資料壞掉（JSON 讀不了）時，先另存一份，避免之後一存檔就把它蓋掉而救不回來
  if (saved) { try { JSON.parse(saved); } catch (e) { writeStore(KEY + ':corrupt-backup', saved); } }
  if (saved) {
    load(saved, '這台電腦存的資料');
  } else {
    load(window.REPORT_DATA || { periods: [] }, '示範資料（全部是假的）');
  }
  $('editMode').checked = !!pref.edit;
  render();
})();
