// 執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../js/report.js');

const root = path.join(__dirname, '..');
const exampleText = fs.readFileSync(path.join(root, 'data', 'report.example.json'), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(root, 'data', 'sample.js'), 'utf8'), ctx);
const CFG = ctx.window.REPORT_CONFIG;
const { data, warnings } = R.normalize(exampleText, CFG);
const [p3, p2, p1] = data.periods;
const plain = o => JSON.parse(JSON.stringify(o)); // vm 物件 → 一般物件

test('範本 JSON 和網頁內建示範資料一模一樣', () => {
  assert.deepEqual(plain(ctx.window.REPORT_DATA), JSON.parse(exampleText));
});

test('示範資料讀進來沒有任何警告，有 3 期且新到舊', () => {
  assert.deepEqual(warnings, []);
  assert.equal(data.periods.length, 3);
  assert.deepEqual(data.periods.map(p => p.start), ['2026-10-12', '2026-10-05', '2026-09-28']);
  assert.equal(data.project, '示範建案');
});

test('示範資料和設定檔對得上：狀態都在設定裡、優先度都有效', () => {
  const keys = CFG.statuses.map(s => s.key);
  const pk = CFG.priorities.map(s => s.key).concat('');
  for (const p of data.periods) {
    for (const it of p.progress.concat(p.todos)) {
      assert.ok(keys.includes(it.status), it.status);
      assert.ok(pk.includes(it.priority), it.priority);
    }
  }
  assert.equal(CFG.project, '示範建案');
  assert.ok(['title', 'circle', 'none'].includes(CFG.maskClients));
});

test('示範資料沒有真實個資：沒有 email、手機號碼都是 0900-000-xxx', () => {
  const all = exampleText + fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.equal(/[\w.+-]+@[\w-]+\.[\w.]+/.test(all), false);
  for (const m of all.match(/09\d{2}-?\d{3}-?\d{3}/g) || []) assert.match(m, /^0900-?000-?\d{3}$/);
});

test('日期：西元、斜線、中文、民國年；不存在的日期回傳空字串', () => {
  assert.equal(R.parseDate('2026-10-05'), '2026-10-05');
  assert.equal(R.parseDate('2026/10/5'), '2026-10-05');
  assert.equal(R.parseDate('2026年10月5日'), '2026-10-05');
  assert.equal(R.parseDate('115/10/05'), '2026-10-05');
  assert.equal(R.parseDate('115年2月28日'), '2026-02-28');
  assert.equal(R.parseDate('2026-02-30'), '');
  assert.equal(R.parseDate('2026-13-01'), '');
  assert.equal(R.parseDate('下週'), '');
  assert.equal(R.parseDate(null), '');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.addDays('2028-02-28', 1), '2028-02-29');
});

test('舊版日期區間文字「2025年4月2日 - 4月4日」與跨年', () => {
  assert.deepEqual(R.parseDateRange('2025年4月2日 - 4月4日'), { start: '2025-04-02', end: '2025-04-04' });
  assert.deepEqual(R.parseDateRange('2026/12/29 ~ 1/2'), { start: '2026-12-29', end: '2027-01-02' });
  assert.deepEqual(R.parseDateRange('2026年5月1日'), { start: '2026-05-01', end: '2026-05-01' });
  assert.deepEqual(R.parseDateRange(''), { start: '', end: '' });
});

test('狀態辨識：key、名稱、帶圖示、同義詞；「未完成」不會被當成完成', () => {
  assert.equal(R.matchStatus('done', CFG), 'done');
  assert.equal(R.matchStatus('進行中', CFG), 'doing');
  assert.equal(R.matchStatus('⚙️ 進行中', CFG), 'doing');
  assert.equal(R.matchStatus('✅ 已完成', CFG), 'done');
  assert.equal(R.matchStatus('暫停', CFG), 'blocked');
  assert.equal(R.matchStatus('未完成', CFG), 'todo');
  assert.equal(R.matchStatus('隨便寫', CFG), null);
  assert.equal(R.matchPriority('急', CFG), 'high');
  assert.equal(R.matchPriority('低', CFG), 'low');
  assert.equal(R.matchPriority('?', CFG), '');
});

test('自訂狀態：多一個「待驗收」也能用，完成判斷跟著 done:true 走', () => {
  const cfg = { statuses: [{ key: 'a', label: '排程' }, { key: 'b', label: '待驗收' }, { key: 'c', label: '結案', done: true }] };
  const r = R.normalize({ periods: [{ start: '2026-01-01', end: '2026-01-07', progress: [{ item: 'x', status: '待驗收' }, { item: 'y', status: '結案' }, { item: 'z' }] }] }, cfg);
  const pr = r.data.periods[0].progress;
  assert.deepEqual(pr.map(i => i.status), ['b', 'c', 'a']);
  const s = R.computeStats(r.data.periods[0], cfg);
  assert.equal(s.done, 1);
  assert.equal(s.total, 3);
});

test('整理資料：缺欄位補空、壞日期移到說明、沒名稱的略過、結束日早於開始日會對調', () => {
  const r = R.normalize({
    periods: [{
      start: '2026-03-10', end: '2026-03-01',
      progress: [{ item: '甲', status: '奇怪狀態', due: '下週三' }, { status: 'done' }, '純文字項目', 42],
      todos: 'not array',
    }],
  }, CFG);
  const p = r.data.periods[0];
  assert.equal(p.start, '2026-03-01');
  assert.equal(p.end, '2026-03-10');
  assert.equal(p.progress.length, 2);
  assert.equal(p.progress[0].status, 'todo');
  assert.equal(p.progress[0].due, '');
  assert.match(p.progress[0].note, /下週三/);
  assert.equal(p.progress[0].owner, '');
  assert.equal(p.progress[1].item, '純文字項目');
  assert.deepEqual(p.todos, []);
  assert.deepEqual(p.plans, []);
  assert.ok(r.warnings.length >= 5, r.warnings.join('\n'));
});

test('整理資料：JSON 壞掉、不是物件、空陣列都不會丟例外', () => {
  assert.deepEqual(R.normalize('{bad json', CFG).data.periods, []);
  assert.match(R.normalize('{bad json', CFG).warnings[0], /JSON/);
  assert.deepEqual(R.normalize(null, CFG).data.periods, []);
  assert.deepEqual(R.normalize([], CFG).data.periods, []);
  assert.deepEqual(R.normalize({ periods: [null, 'x'] }, CFG).data.periods, []);
});

test('吃得下舊版格式（reports + 最外層 completed / clients）', () => {
  const old = {
    reports: [
      { dateRange: '2025年4月2日 - 4月4日', progress: [{ item: '使照', status: '⚙️ 進行中', note: 'n' }], todos: [{ task: '量尺寸', person: '示範業務A', progress: '待約' }] },
      { dateRange: '2025年4月8日 - 4月9日', progress: [] },
    ],
    completed: [{ item: '透天使照', date: '4/4前', note: '' }],
    clients: [{ client: '王先生', person: '示範業務B', progress: '帶看 1 次' }],
  };
  const r = R.normalize(old, CFG);
  const [newest, older] = r.data.periods;
  assert.equal(newest.start, '2025-04-08');
  assert.equal(older.progress[0].status, 'doing');
  assert.equal(older.todos[0].owner, '示範業務A');
  assert.equal(older.todos[0].note, '待約');
  assert.equal(newest.clients[0].owner, '示範業務B');
  assert.equal(newest.completed[0].item, '透天使照');
  assert.ok(r.warnings.some(w => /舊版/.test(w)));
});

test('期別排序：新到舊，沒日期的放最後', () => {
  const s = R.sortPeriods([{ start: '2026-01-01', end: '2026-01-07' }, { start: '', end: '' }, { start: '2026-02-01', end: '2026-02-07' }]);
  assert.deepEqual(s.map(p => p.start), ['2026-02-01', '2026-01-01', '']);
});

test('統計：示範最新一期的狀態分布、完成率、逾期', () => {
  const s = R.computeStats(p3, CFG);
  assert.equal(s.total, 7);
  assert.deepEqual(plain(s.byStatus), { todo: 2, doing: 3, blocked: 1, done: 1 });
  assert.equal(s.done, 1);
  assert.ok(Math.abs(s.completionRate - 1 / 7) < 1e-12);
  // 以期末 10/18 為基準：車位配置圖（10/10，卡關）、A3 量窗簾（10/16）逾期；使照雖期限 10/15 但已完成
  assert.equal(s.overdue, 2);
  assert.deepEqual(s.overdueItems.map(x => x.item.item || x.item.task).sort(), ['A3 量窗簾尺寸', 'B 棟車位配置圖確認'].sort());
  assert.equal(s.clientsDue, 1); // 張太太 10/15 該跟進
  assert.equal(R.computeStats(p3, CFG, '2026-10-01').overdue, 0);
  assert.equal(R.computeStats({ progress: [], todos: [] }, CFG).completionRate, 0);
});

test('本期 vs 上期：新完成、狀態變化、計畫轉待辦、新增、客戶進展', () => {
  const d = R.diffPeriods(p3, p2, CFG);
  assert.deepEqual(d.newlyDone.map(x => x.name).sort(), ['使用執照申請', '樣品屋燈光調整'].sort());
  assert.deepEqual(d.statusChanged.find(x => x.name === 'B 棟車位配置圖確認'), { section: 'progress', name: 'B 棟車位配置圖確認', from: 'doing', to: 'blocked' });
  assert.deepEqual(d.moved, [{ name: '交屋前驗屋時程表', from: 'plans', to: 'todos' }]);
  assert.ok(d.added.some(x => x.name === '接待中心冷氣維修'));
  // 上期已完成、本期沒列的不算「拿掉」
  assert.equal(d.removed.some(x => x.name === '整理已繳尾款戶別'), false);
  assert.deepEqual(d.clientAdded.map(x => x.name), ['李先生']);
  assert.equal(d.clientChanged.length, 3);
  assert.equal(R.diffPeriods(p1, null, CFG), null);
});

test('本期 vs 上期：上期沒完成、本期沒列也沒進「本期完成」的才算拿掉', () => {
  const d = R.diffPeriods(p2, p1, CFG);
  assert.deepEqual(d.removed.map(x => x.name), ['消防查驗文件補件']);
  assert.deepEqual(d.moved, [{ name: 'B 棟車位配置圖確認', from: 'plans', to: 'progress' }]);
  const same = R.diffPeriods(p2, p2, CFG);
  assert.equal(same.count, 0);
});

test('姓名遮蔽：title / circle / none、複姓、戶別代號、英文', () => {
  assert.equal(R.maskName('王先生', 'title'), '王先生');
  assert.equal(R.maskName('王大明先生', 'title'), '王先生');
  assert.equal(R.maskName('王大明', 'title'), '王○○');
  assert.equal(R.maskName('王先生', 'circle'), '王○○');
  assert.equal(R.maskName('陳小姐', 'circle'), '陳○○');
  assert.equal(R.maskName('歐陽美美小姐', 'title'), '歐陽小姐');
  assert.equal(R.maskName('A3-王大明', 'title'), 'A3-王○○');
  assert.equal(R.maskName('12樓-李大明', 'title'), '12樓-李○○');
  assert.equal(R.maskName('Amy Chen', 'title'), 'A○○');
  assert.equal(R.maskName('王大明', 'none'), '王大明');
  assert.equal(R.maskName('', 'title'), '');
  assert.equal(R.maskMode({}), 'title');
  assert.equal(R.maskMode({ maskClients: false }), 'none');
});

test('客戶追蹤文字裡的手機號碼會被遮掉', () => {
  assert.equal(R.maskPhones('請回電 0900-000-123'), '請回電 0900-***-***');
  assert.equal(R.maskPhones('0900000123'), '0900-***-***');
  const c = R.maskClient({ client: '吳大華', progress: '電話 0900 000 456' }, { maskClients: 'circle' });
  assert.equal(c.client, '吳○○');
  assert.equal(c.progress, '電話 0900-***-***');
  assert.equal(R.maskClient({ client: '吳大華' }, { maskClients: 'none' }).client, '吳大華');
});

test('LINE 文字版：有標題、完成率、逾期標記，客戶已遮蔽，與上期比較', () => {
  const cfg = Object.assign({}, CFG, { maskClients: 'circle' });
  const t = R.lineText(p3, cfg, { prev: p2 });
  const lines = t.split('\n');
  assert.equal(lines[0], '【示範建案 工作進度彙報】');
  assert.equal(lines[1], '示範行銷團隊｜2026/10/12 – 10/18');
  assert.match(lines[2], /^完成率 14%（1\/7）.*逾期 2$/);
  assert.match(t, /B 棟車位配置圖確認［卡關］（示範業務A，10\/10（逾期），優先）/);
  assert.match(t, /■ 客戶追蹤（姓名已遮蔽）/);
  assert.match(t, /・王○○［議價］/);
  assert.equal(/王先生|陳小姐|張太太|李先生/.test(t), false);
  assert.match(t, /■ 與上期（2026\/10\/5 – 10\/11）相比/);
  assert.match(t, /新完成：/);
  assert.equal(/<|>/.test(t), false); // 純文字，沒有 HTML
  assert.equal(R.lineText(null, CFG), '');
});

test('新增一期：日期接續、只帶沒完成的、計畫轉待辦、客戶全帶、完成清空', () => {
  const n = R.newPeriodFrom(p3, CFG, {});
  assert.equal(n.start, '2026-10-19');
  assert.equal(n.end, '2026-10-25');
  assert.equal(n.progress.some(i => i.item === '使用執照申請'), false);
  assert.equal(n.progress.length, 3);
  assert.ok(n.todos.some(t => t.task === '交屋說明會' && t.status === 'todo' && t.due === '2026-10-26'));
  assert.equal(n.clients.length, 4);
  assert.deepEqual(n.completed, []);
  assert.notEqual(n.progress[0].id, p3.progress[1].id);
  const blank = R.newPeriodFrom(p3, CFG, { carry: false, start: '2026-11-01', end: '2026-11-30' });
  assert.equal(blank.todos.length + blank.progress.length + blank.clients.length, 0);
  assert.equal(blank.end, '2026-11-30');
});

test('HTML 跳脫：五個特殊字元都會轉', () => {
  assert.equal(R.escapeHTML(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(R.escapeHTML(null), '');
  assert.equal(R.escapeHTML(0), '0');
});

test('畫面程式沒有把資料塞進 innerHTML，也沒有外部網路資源', () => {
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(app), false);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(/(src|href)=["']https?:/i.test(html), false);
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.equal(/url\(|@import/i.test(css), false);
});

test('期間文字：同年省略年份、單日、自訂標題', () => {
  assert.equal(R.periodLabel({ start: '2026-12-29', end: '2027-01-02' }), '2026/12/29 – 2027/1/2');
  assert.equal(R.periodLabel({ start: '2026-05-01', end: '2026-05-01' }), '2026/5/1');
  assert.equal(R.periodLabel({ start: '2026-05-01', end: '2026-05-07', title: '五月第一週' }), '五月第一週');
});
