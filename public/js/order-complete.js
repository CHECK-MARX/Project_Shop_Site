/* order-complete.js — 注文完了表示（堅牢版） */
(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const fmtJPY = window.fmtJPY || (n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`);

  function findMount() {
    // 既存の容れ物に合わせて自動検出（なければ生成）
    return $('#orderText') || $('#orderInfo') || $('#orderSummary') || (() => {
      const box = document.createElement('div');
      box.id = 'orderSummary';
      box.className = 'modal-content';
      box.style.maxWidth = '960px';
      const main = document.querySelector('main') || document.body;
      main.appendChild(box);
      return box;
    })();
  }

  async function apiAuthGet(url) {
    const t = (window.Auth?.getToken?.() || localStorage.getItem('token') || '').trim();
    const r = await fetch(url, { headers: { ...(t ? { Authorization:`Bearer ${t}` } : {}) } });
    const b = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(b.error || r.status);
    return b;
  }

  function calcFromItems(items=[]) {
    let subtotal = 0;
    for (const it of items) {
      const unit = Number(it.unitPrice ?? it.price ?? 0);
      const qty  = Number(it.qty ?? 0);
      subtotal += unit * qty;
    }
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    return { subtotal, tax, total };
  }

  function render(order) {
    const host = findMount();

    // 明細の行を組み立て
    const lines = (order.items||[]).map(it => {
      const unit = Number(it.unitPrice ?? it.price ?? 0);
      const qty  = Number(it.qty ?? 0);
      return `${it.name} x${qty} @${fmtJPY(unit)} = ${fmtJPY(unit*qty)}`;
    });

    // ヘッダの数値が 0/未定義なら明細から再計算
    let subtotal = Number(order.subtotal ?? 0);
    let tax      = Number(order.tax ?? 0);
    let total    = Number(order.total ?? 0);
    if (!(subtotal>0) && (order.items?.length)) {
      const r = calcFromItems(order.items);
      subtotal = r.subtotal; tax = r.tax; total = r.total;
    }

    const dt = new Date(order.created_at || Date.now());
    const when = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ` +
                 `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;

    host.textContent = ''; // クリア
    const pre = document.createElement('div');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.lineHeight = '1.7';
    pre.textContent =
      `注文ID: ${order.orderId}  日時: ${when}\n` +
      `--- 明細 ---\n` +
      (lines.length ? '・' + lines.join('  /  ・') : '(明細なし)') + '\n' +
      `----------------\n` +
      `小計: ${fmtJPY(subtotal)}   税: ${fmtJPY(tax)}   合計: ${fmtJPY(total)}\n` +
      `支払: **** ${order.last4 ?? '****'}`;
    host.appendChild(pre);
  }

  async function main() {
    try {
      const ref = new URLSearchParams(location.search).get('ref') || '';
      if (!ref) throw new Error('no_ref');
      const order = await apiAuthGet(`/api/orders/${encodeURIComponent(ref)}`);
      render(order);
    } catch (e) {
      console.error(e);
      const host = findMount();
      host.textContent = '注文情報の取得に失敗しました。';
    }

    // ボタン類の配線（存在すれば）
    const okBtns = ['#okBtn', '#ok', '[data-ok]'].map(s=>$(s)).filter(Boolean);
    okBtns.forEach(b => b.addEventListener('click', ()=> location.href = './index.html'));
    const pr = $('#printBtn') || $('[data-print]');
    pr && pr.addEventListener('click', ()=> window.print());
    const cont = $('#continueBtn') || $('[data-continue]');
    cont && cont.addEventListener('click', ()=> location.href = './products.html');
  }

  document.addEventListener('DOMContentLoaded', main);
})();
