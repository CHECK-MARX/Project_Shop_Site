// public/js/sales_history.js
// 売上履歴（管理）: レイアウト自動生成＋件数表示＋ページング。/api/admin/sales-timeline のみ使用。

(() => {
  'use strict';
  if (window.__SALES_HIST_WIRED__) return;
  window.__SALES_HIST_WIRED__ = true;

  // ---- helpers ----
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;
  const Auth = window.Auth || {
    getToken(){ return localStorage.getItem('token') || ''; },
    isLoggedIn(){ return !!localStorage.getItem('token'); }
  };

  // ---- レイアウト生成（無ければ作る） ----
  function ensureLayout(){
    // 既に tbody があれば何もしない
    if ($('#salesTbody')) return;

    // どこに差し込むか
    const host = $('.admin-section') || $('main') || document.body;

    // 件数欄
    let topBar = $('#hitCount');
    if (!topBar) {
      topBar = document.createElement('div');
      topBar.id = 'hitCount';
      topBar.style.cssText = 'margin:8px 0 12px 0;font-weight:700;';
      host.prepend(topBar);
    }

    // フィルタが無いページ用に最低限の UI を作る（既にあるページではスキップされる）
    const needFilter = !$('#qUser') && !$('#qProduct');
    if (needFilter) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px;';
      row.innerHTML = `
        <input id="qUser"    placeholder="ユーザー (部分一致)"   class="input">
        <input id="qProduct" placeholder="商品名 (部分一致)"     class="input">
        <input id="qMin"     placeholder="金額(以上)"            class="input" style="width:120px">
        <input id="qMax"     placeholder="金額(以下)"            class="input" style="width:120px">
        <button id="btnSearch" class="btn btn-primary">検索</button>
        <button id="btnClear"  class="btn">クリア</button>
        <button id="btnReload" class="btn">最新を再取得</button>
      `;
      host.appendChild(row);
    }

    // テーブル
    const tblWrap = document.createElement('div');
    tblWrap.innerHTML = `
      <table class="table" style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px">日時</th>
            <th style="text-align:left;padding:8px">ユーザー</th>
            <th style="text-align:left;padding:8px">商品名</th>
            <th style="text-align:right;padding:8px">数量</th>
            <th style="text-align:right;padding:8px">単価</th>
            <th style="text-align:right;padding:8px">小計（行）</th>
            <th style="text-align:left;padding:8px">注文ID</th>
          </tr>
        </thead>
        <tbody id="salesTbody"></tbody>
      </table>
      <div style="margin:16px 0">
        <button id="btnMore" class="btn">さらに読み込む</button>
      </div>
    `;
    host.appendChild(tblWrap);
  }

  // ---- 状態 ----
  const state = { offset:0, limit:50, loaded:0, filters:{} };

  function els(){
    // 呼び出し時点で取得（自動生成後に存在する）
    return {
      qUser   : $('#qUser'),
      qProduct: $('#qProduct'),
      qMin    : $('#qMin'),
      qMax    : $('#qMax'),
      btnSearch: $('#btnSearch'),
      btnClear : $('#btnClear'),
      btnMore  : $('#btnMore'),
      btnReload: $('#btnReload'),
      tbody    : $('#salesTbody'),
      countEl  : $('#hitCount')
    };
  }

  const readFilters = ({qUser,qProduct,qMin,qMax}) => {
    const v = el => (el && typeof el.value === 'string') ? el.value.trim() : '';
    const f = {};
    if (v(qUser))    f.user    = v(qUser);
    if (v(qProduct)) f.product = v(qProduct);
    if (v(qMin))     f.min     = v(qMin);
    if (v(qMax))     f.max     = v(qMax);
    return f;
  };

  function updateCount(countEl){
    if (!countEl) return;
    countEl.textContent = `表示件数: ${state.loaded}（全件表示）`;
  }

  const rowHTML = r => `
    <tr>
      <td style="padding:8px">${(r.created_at||'').replace('T',' ').replace('.000Z','')}</td>
      <td style="padding:8px">${r.user || '退会ユーザー'}</td>
      <td style="padding:8px">${r.product || ''}</td>
      <td style="padding:8px;text-align:right">${r.qty}</td>
      <td style="padding:8px;text-align:right">${fmtJPY(r.unit)}</td>
      <td style="padding:8px;text-align:right">${fmtJPY(r.line)}</td>
      <td style="padding:8px">${r.orderRef ? String(r.orderRef) : ''}</td>
    </tr>`;

  async function fetchSales({ append=false } = {}){
    const { tbody, countEl } = els();

    const t = (Auth.getToken?.() || '').trim();
    if (!t){
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:#ff9a9a;padding:8px">取得に失敗しました（権限が必要な可能性）</td></tr>`;
      updateCount(countEl);
      return;
    }

    const qs = new URLSearchParams();
    const f = state.filters;
    if (f.user)    qs.set('user', f.user);
    if (f.product) qs.set('product', f.product);
    if (f.min)     qs.set('min', f.min);
    if (f.max)     qs.set('max', f.max);
    qs.set('limit',  String(state.limit));
    qs.set('offset', String(state.offset));

    try{
      const r = await fetch(`/api/admin/sales-timeline?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (!r.ok){
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:#ff9a9a;padding:8px">取得に失敗しました（HTTP ${r.status}）</td></tr>`;
        return;
      }
      const rows = await r.json();

      if (!append) { state.loaded = 0; if (tbody) tbody.innerHTML = ''; }
      if (tbody)   tbody.insertAdjacentHTML('beforeend', rows.map(rowHTML).join(''));
      state.loaded += rows.length;
      state.offset += rows.length;

      const { btnMore } = els();
      if (btnMore) btnMore.disabled = rows.length < state.limit;

      updateCount(countEl);
    }catch(e){
      console.error(e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:#ff9a9a;padding:8px">取得に失敗しました</td></tr>`;
    }
  }

  function wire(){
    const E = els();
    const doSearch = () => {
      state.filters = readFilters(E);
      state.offset  = 0;
      fetchSales({ append:false });
    };
    const clearFilters = () => {
      ['qUser','qProduct','qMin','qMax'].forEach(k => { if (E[k]) E[k].value=''; });
      doSearch();
    };
    const loadMore = () => fetchSales({ append:true });

    E.btnSearch && E.btnSearch.addEventListener('click', doSearch);
    E.btnClear  && E.btnClear .addEventListener('click', clearFilters);
    E.btnMore   && E.btnMore  .addEventListener('click', loadMore);
    E.btnReload && E.btnReload.addEventListener('click', ()=>{ state.offset=0; fetchSales({append:false}); });

    [E.qUser,E.qProduct,E.qMin,E.qMax].forEach(el=>{
      el && el.addEventListener('keydown', e=>{ if (e.key==='Enter') doSearch(); });
    });

    // 初回
    state.filters = readFilters(E);
    state.offset  = 0;
    fetchSales({ append:false });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureLayout();
    wire();
  });
})();
