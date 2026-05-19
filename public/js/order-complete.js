/* order-complete.js - order summary page */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const fmtJPY = window.fmtJPY || ((n) => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`);

  function findMount() {
    return $('#orderText') || $('#orderInfo') || $('#orderSummary') || (() => {
      const box = document.createElement('div');
      box.id = 'orderSummary';
      box.className = 'modal-content';
      box.style.maxWidth = '960px';
      (document.querySelector('main') || document.body).appendChild(box);
      return box;
    })();
  }

  async function apiAuthGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || String(res.status));
    return body;
  }

  function calcFromItems(items = []) {
    let subtotal = 0;
    for (const item of items) {
      const unit = Number(item.unitPrice ?? item.price ?? 0);
      const qty = Number(item.qty ?? 0);
      subtotal += unit * qty;
    }
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    return { subtotal, tax, total };
  }

  function render(order) {
    const host = findMount();

    const lines = (order.items || []).map((item) => {
      const name = String(item.name || '');
      const unit = Number(item.unitPrice ?? item.price ?? 0);
      const qty = Number(item.qty ?? 0);
      return `${name} x${qty} @${fmtJPY(unit)} = ${fmtJPY(unit * qty)}`;
    });

    let subtotal = Number(order.subtotal ?? 0);
    let tax = Number(order.tax ?? 0);
    let total = Number(order.total ?? 0);
    if (!(subtotal > 0) && (order.items?.length || 0) > 0) {
      const computed = calcFromItems(order.items);
      subtotal = computed.subtotal;
      tax = computed.tax;
      total = computed.total;
    }

    const dt = new Date(order.created_at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const when = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

    host.textContent = '';
    const pre = document.createElement('div');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.lineHeight = '1.7';
    pre.textContent =
      `注文ID: ${String(order.orderId || '')}  日時: ${when}\n` +
      `--- 商品 ---\n` +
      (lines.length ? `・${lines.join('  /  ・')}` : '(商品なし)') + '\n' +
      `----------------\n` +
      `小計: ${fmtJPY(subtotal)}   税: ${fmtJPY(tax)}   合計: ${fmtJPY(total)}\n` +
      `カード: **** ${String(order.last4 || '****')}`;
    host.appendChild(pre);
  }

  async function main() {
    try {
      const ref = new URLSearchParams(location.search).get('ref') || '';
      if (!ref) throw new Error('no_ref');
      const order = await apiAuthGet(`/api/orders/${encodeURIComponent(ref)}`);
      render(order);
    } catch (_) {
      const host = findMount();
      host.textContent = '注文情報の取得に失敗しました。';
    }

    ['#okBtn', '#ok', '[data-ok]'].map((s) => $(s)).filter(Boolean)
      .forEach((btn) => btn.addEventListener('click', () => { location.href = './index.html'; }));

    $('#printBtn')?.addEventListener('click', () => window.print());
    $('[data-print]')?.addEventListener('click', () => window.print());

    $('#continueBtn')?.addEventListener('click', () => { location.href = './products.html'; });
    $('[data-continue]')?.addEventListener('click', () => { location.href = './products.html'; });
  }

  document.addEventListener('DOMContentLoaded', main);
})();
