// public/js/sales_history.js - secure renderer for sales timeline
(() => {
  'use strict';
  if (window.__SALES_HIST_WIRED__) return;
  window.__SALES_HIST_WIRED__ = true;

  const $ = (s, r = document) => r.querySelector(s);
  const fmtJPY = (n) => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`;

  const state = {
    offset: 0,
    limit: 50,
    loaded: 0,
    filters: {}
  };

  function text(value) {
    return String(value ?? '');
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function createCell(value, align = 'left') {
    const td = document.createElement('td');
    td.style.padding = '8px';
    td.style.textAlign = align;
    td.textContent = text(value);
    return td;
  }

  function setStatus(message, isError = false) {
    const msg = $('#salesMessage');
    if (!msg) return;
    msg.textContent = message;
    msg.style.color = isError ? '#ff9a9a' : '#9fb0d4';
  }

  function updateCount() {
    const countEl = $('#hitCount');
    if (!countEl) return;
    countEl.textContent = `表示件数: ${state.loaded}`;
  }

  function ensureLayout() {
    if ($('#salesTbody')) return;

    const host = $('.admin-section') || $('main') || document.body;

    const count = document.createElement('div');
    count.id = 'hitCount';
    count.style.cssText = 'margin:8px 0 6px 0;font-weight:700;';
    host.appendChild(count);

    const message = document.createElement('div');
    message.id = 'salesMessage';
    message.style.cssText = 'margin:0 0 12px 0;font-size:13px;';
    host.appendChild(message);

    const filters = document.createElement('div');
    filters.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px;';

    const mkInput = (id, placeholder, width) => {
      const input = document.createElement('input');
      input.id = id;
      input.className = 'input';
      input.placeholder = placeholder;
      if (width) input.style.width = width;
      return input;
    };

    const qUser = mkInput('qUser', 'ユーザー (部分一致)');
    const qProduct = mkInput('qProduct', '商品名 (部分一致)');
    const qMin = mkInput('qMin', '最低金額', '120px');
    const qMax = mkInput('qMax', '最高金額', '120px');

    const mkButton = (id, label, className = 'btn') => {
      const btn = document.createElement('button');
      btn.id = id;
      btn.className = className;
      btn.type = 'button';
      btn.textContent = label;
      return btn;
    };

    filters.appendChild(qUser);
    filters.appendChild(qProduct);
    filters.appendChild(qMin);
    filters.appendChild(qMax);
    filters.appendChild(mkButton('btnSearch', '検索', 'btn btn-primary'));
    filters.appendChild(mkButton('btnClear', 'クリア'));
    filters.appendChild(mkButton('btnReload', '再読込'));
    host.appendChild(filters);

    const table = document.createElement('table');
    table.className = 'table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headers = [
      ['日時', 'left'],
      ['ユーザー', 'left'],
      ['商品', 'left'],
      ['数量', 'right'],
      ['単価', 'right'],
      ['小計', 'right'],
      ['注文ID', 'left']
    ];

    headers.forEach(([label, align]) => {
      const th = document.createElement('th');
      th.style.padding = '8px';
      th.style.textAlign = align;
      th.textContent = label;
      headRow.appendChild(th);
    });

    head.appendChild(headRow);
    table.appendChild(head);

    const tbody = document.createElement('tbody');
    tbody.id = 'salesTbody';
    table.appendChild(tbody);

    host.appendChild(table);

    const moreWrap = document.createElement('div');
    moreWrap.style.margin = '16px 0';
    const moreBtn = mkButton('btnMore', 'さらに読み込む');
    moreWrap.appendChild(moreBtn);
    host.appendChild(moreWrap);
  }

  function readFilters() {
    const val = (id) => text($(id)?.value).trim();
    const filters = {};
    const user = val('#qUser');
    const product = val('#qProduct');
    const min = val('#qMin');
    const max = val('#qMax');

    if (user) filters.user = user;
    if (product) filters.product = product;
    if (min) filters.min = min;
    if (max) filters.max = max;
    return filters;
  }

  function appendRows(rows, appendMode) {
    const tbody = $('#salesTbody');
    if (!tbody) return;

    if (!appendMode) {
      clear(tbody);
      state.loaded = 0;
    }

    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.appendChild(createCell(text(row.created_at || '').replace('T', ' ').replace('.000Z', '')));
      tr.appendChild(createCell(row.user || '匿名ユーザー'));
      tr.appendChild(createCell(row.product || ''));
      tr.appendChild(createCell(Number(row.qty || 0), 'right'));
      tr.appendChild(createCell(fmtJPY(row.unit), 'right'));
      tr.appendChild(createCell(fmtJPY(row.line), 'right'));
      tr.appendChild(createCell(row.orderRef || ''));
      tbody.appendChild(tr);
    });

    state.loaded += rows.length;
    updateCount();
  }

  async function fetchSales({ append = false } = {}) {
    const qs = new URLSearchParams();

    Object.entries(state.filters).forEach(([k, v]) => {
      if (v) qs.set(k, String(v));
    });

    qs.set('limit', String(state.limit));
    qs.set('offset', String(state.offset));

    setStatus('読み込み中...');

    try {
      const res = await fetch(`/api/admin/sales-timeline?${qs.toString()}`, { credentials: 'include' });
      if (res.status === 401) {
        appendRows([], false);
        setStatus('Unauthorized', true);
        return;
      }
      if (!res.ok) {
        appendRows([], false);
        setStatus(`Failed (HTTP ${res.status})`, true);
        return;
      }

      const rows = await res.json();
      const list = Array.isArray(rows) ? rows : [];

      appendRows(list, append);
      state.offset += list.length;

      const btnMore = $('#btnMore');
      if (btnMore) btnMore.disabled = list.length < state.limit;

      setStatus(list.length ? '' : 'データがありません。');
    } catch (_) {
      appendRows([], false);
      setStatus('Failed to load', true);
    }
  }

  function wireEvents() {
    const doSearch = () => {
      state.filters = readFilters();
      state.offset = 0;
      fetchSales({ append: false });
    };

    const clearSearch = () => {
      ['#qUser', '#qProduct', '#qMin', '#qMax'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
      });
      doSearch();
    };

    $('#btnSearch')?.addEventListener('click', doSearch);
    $('#btnClear')?.addEventListener('click', clearSearch);
    $('#btnReload')?.addEventListener('click', () => {
      state.offset = 0;
      fetchSales({ append: false });
    });
    $('#btnMore')?.addEventListener('click', () => fetchSales({ append: true }));

    ['#qUser', '#qProduct', '#qMin', '#qMax'].forEach((id) => {
      $(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    });

    state.filters = readFilters();
    state.offset = 0;
    fetchSales({ append: false });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureLayout();
    wireEvents();
  });
})();
