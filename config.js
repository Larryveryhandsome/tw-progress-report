/*
 * tw-progress-report 設定檔
 * 用記事本打開就能改，改完存檔、重新整理網頁即可。
 */
window.REPORT_CONFIG = {
  title: '工作進度彙報',     // 標題（會接在專案名稱後面）
  project: '示範建案',        // 專案／案場名稱（資料檔裡有 project 時以資料檔為準）
  team: '示範行銷團隊',       // 團隊名稱，顯示在副標題

  // 狀態：key 是資料裡存的值，label 是畫面上的字，icon 會出現在 LINE 文字版
  // done: true 代表「算完成」（計算完成率、逾期時用）。可以自己加減，例如加一個「待驗收」。
  statuses: [
    { key: 'todo', label: '未開始', icon: '○', color: '#6b7280' },
    { key: 'doing', label: '進行中', icon: '◐', color: '#2563eb' },
    { key: 'blocked', label: '卡關', icon: '⚠', color: '#dc2626' },
    { key: 'done', label: '完成', icon: '✔', color: '#16a34a', done: true },
  ],

  // 優先度
  priorities: [
    { key: 'high', label: '高' },
    { key: 'normal', label: '中' },
    { key: 'low', label: '低' },
  ],

  // 客戶姓名遮蔽（畫面、列印、LINE 文字版都會套用；編輯表單內仍顯示原文）
  //   'title'  王大明先生 → 王先生；王大明 → 王○○（預設）
  //   'circle' 一律 姓＋○○：王先生 → 王○○
  //   'none'   不遮蔽（原則上不建議，彙報常被轉傳）
  maskClients: 'title',

  // 逾期的判斷基準：'period' 用該期結束日（彙報當時的角度）；'today' 用今天
  overdueBase: 'period',

  // 瀏覽器存資料用的名稱；同一台電腦要放兩個案場時，改成不同名稱即可
  storageKey: 'tw-progress-report',
};
