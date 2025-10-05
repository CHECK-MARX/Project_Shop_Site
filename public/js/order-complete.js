async function fetchOrderByRef(ref){
  const t = (window.Auth?.getToken?.() || '').trim();
  const r = await fetch(`/api/my-orders/${encodeURIComponent(ref)}`, {
    headers: { ...(t ? {Authorization:`Bearer ${t}`} : {}) }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function renderOrder() {
  const box = $('#orderSummary');
  if (!box) return;

  // 1) ?ref=xxxxx があればサーバから取得
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref) {
    try {
      const o = await fetchOrderByRef(ref);
      sessionStorage.setItem('last_order', JSON.stringify({
        orderId:o.orderId, createdAt:o.created_at, payerName:o.payerName, cardLast4:o.last4,
        user:(window.Auth?.getUser?.()||{}).username||'',
        items:(o.items||[]).map(i=>({id:i.productId,name:i.name,unitPrice:i.unitPrice,qty:i.qty,lineTotal:i.lineTotal})),
        subtotal:o.subtotal, tax:o.tax, totalCharged:o.total
      }));
    } catch(e) {
      console.error(e);
    }
  }

  // …以降は先にご提供した render のまま（sessionStorage から描画）
}

/* order-complete.js — 注文完了ページ描画 */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;

function renderOrder() {
  const box = $('#orderSummary');
  if (!box) return;

  let order = null;
  try { order = JSON.parse(sessionStorage.getItem('last_order')||''); } catch {}
  if (!order || !order.items || !order.items.length) {
    box.innerHTML = `
      <div class="alert alert-info">
        注文情報が見つかりませんでした。<a href="./products.html">商品一覧へ</a>
      </div>`;
    return;
  }

  const rows = order.items.map(i => `
    <tr>
      <td>${i.name || '商品'}</td>
      <td style="text-align:right;">${fmtJPY(i.unitPrice)}</td>
      <td style="text-align:center;">× ${i.qty}</td>
      <td style="text-align:right; font-weight:700;">${fmtJPY(i.lineTotal)}</td>
    </tr>
  `).join('');

  const created = new Date(order.createdAt || Date.now());
  const createdStr = `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,'0')}-${String(created.getDate()).padStart(2,'0')} `
    + `${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}`;

  box.innerHTML = `
    <div style="display:grid; gap:10px;">
      <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:baseline;">
        <div class="sum-ttl">注文ID: <span style="font-family:monospace">${order.orderId}</span></div>
        <div style="opacity:.85">注文日時: ${createdStr}</div>
      </div>

      <div style="opacity:.9">注文者: <strong>${order.payerName || order.user || '-'}</strong></div>
      <div style="opacity:.9">支払方法: <strong>クレジットカード（**** ${order.cardLast4 || '****'}）</strong></div>

      <div style="overflow:auto;">
        <table class="table" style="min-width:640px;">
          <thead>
            <tr>
              <th>商品</th>
              <th style="text-align:right;">単価</th>
              <th style="text-align:center;">数量</th>
              <th style="text-align:right;">小計</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div style="display:grid; gap:6px; margin-top:4px;">
        <div style="display:flex; justify-content:flex-end; gap:16px;">
          <div style="opacity:.85">小計</div>
          <div style="min-width:120px; text-align:right;">${fmtJPY(order.subtotal)}</div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:16px;">
          <div style="opacity:.85">消費税 (10%)</div>
          <div style="min-width:120px; text-align:right;">${fmtJPY(order.tax)}</div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:16px; font-weight:900;">
          <div>合計</div>
          <div style="min-width:120px; text-align:right; color:#34d399;">${fmtJPY(order.totalCharged)}</div>
        </div>
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  renderOrder();
  // カートバッジを0に（script.jsのヘルパがあればそれでOK）
  try { window.updateCartBadge && window.updateCartBadge(); } catch {}

  $('#okBtn')?.addEventListener('click', () => {
    // ページ離脱時に詳細を残さない場合は、下行のコメントを外す
    // sessionStorage.removeItem('last_order');
    location.href = './index.html';
  });

  $('#printBtn')?.addEventListener('click', () => window.print());
});
