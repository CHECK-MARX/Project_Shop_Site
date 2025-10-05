/* script.js — 商品一覧 / カート（ユーザー別・旧HTML互換/多重読込OK） */

/* ---- duplicate-load guard ---- */
if (!window.__APP_CORE_LOADED__) {
  window.__APP_CORE_LOADED__ = true;
}

/* 既存があればそれを使い、無ければ定義（←再宣言エラー防止） */
const $  = window.$  || ((s, r=document) => r.querySelector(s));
const $$ = window.$$ || ((s, r=document) => Array.from(r.querySelectorAll(s)));
const fmtJPY = window.fmtJPY || (n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`);
/* 他ファイルからも使えるよう公開（1回だけ代入される） */
window.$ = $; window.$$ = $$; window.fmtJPY = fmtJPY;

/* ===== Auth ブリッジ（auth.js が無ければ最小実装） ===== */
const Auth = window.Auth || {
  getToken(){ return localStorage.getItem('token') || ''; },
  getUser(){ try{ const raw = localStorage.getItem('auth_user'); return raw?JSON.parse(raw):null; }catch{ return null; } },
  isLoggedIn(){ return !!localStorage.getItem('token'); },
  openLogin(){ const m = $('#loginModal'); if (m){ m.classList.remove('hidden'); m.classList.add('open'); document.body.classList.add('modal-open'); } }
};

/* ===== カート（ユーザー別保存） ===== */
function cartKey(){ const u = Auth.getUser(); return `cart:${u?.username || 'guest'}`; }
function getCart(){ try{ return JSON.parse(localStorage.getItem(cartKey())||'[]'); }catch{ return []; } }
function setCart(list){
  localStorage.setItem(cartKey(), JSON.stringify(list));
  updateCartBadge();
  renderCartPage(); // 表示更新
}
function updateCartBadge(){
  const badge = $('#cartCount'); if (!badge) return;
  const q = getCart().reduce((s,i)=> s + (Number(i.qty)||0), 0);
  if (q>0){ badge.style.display='inline-block'; badge.textContent=String(q); }
  else { badge.style.display='none'; badge.textContent='0'; }
}
function clearGuestCartOnLogin(){
  const u = Auth.getUser(); if (!u) return;
  try{
    const guest = JSON.parse(localStorage.getItem('cart:guest')||'[]');
    if (!guest.length) return;
    const cur = getCart();
    for (const g of guest){
      const i = cur.findIndex(x=>x.productId===g.productId);
      if (i>=0) cur[i].qty = (cur[i].qty||0)+(g.qty||0);
      else cur.push(g);
    }
    setCart(cur);
    localStorage.removeItem('cart:guest');
  }catch{}
}

/* ===== API ===== */
async function apiGet(p){ const r = await fetch(p); if(!r.ok) throw new Error(r.status); return r.json(); }

/* ===== 商品一覧 ===== */
async function loadProducts(search=""){
  try{
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const items = await apiGet(`/api/products${qs}`);
    const grid = $('#productsGrid'); if (!grid) return;

    if (!items?.length){
      grid.innerHTML = `<div class="alert alert-info" style="grid-column:1/-1;text-align:center">商品が見つかりませんでした</div>`;
      return;
    }

    grid.innerHTML = items.map(p=>`
      <div class="product-card" data-id="${p.id}" data-name="${p.name}" data-price="${Math.round(Number(p.price)||0)}">
        <img class="product-img" src="${p.image_path || `https://picsum.photos/seed/p${p.id}/800/500`}" alt="${p.name}">
        <h3>${p.name}</h3>
        <p>${p.description || ''}</p>
        <div class="product-price">${fmtJPY(p.price)}</div>
        <div class="product-stock">在庫: ${Number(p.stock||0)}個</div>
        <button class="btn btn-primary add-to-cart">カートに追加</button>
      </div>
    `).join('');

    $$('.add-to-cart', grid).forEach(btn=>{
      btn.addEventListener('click', e=>{
        const card = e.currentTarget.closest('.product-card');
        const product = {
          id: Number(card.dataset.id),
          name: card.dataset.name,
          price: Number(card.dataset.price)||0
        };

        if (!Auth.isLoggedIn()){
          toast('ログインするとカートに追加できます');
          Auth.openLogin();
          return;
        }
        const list = getCart();
        const i = list.findIndex(x=>x.productId===product.id);
        if (i>=0) list[i].qty = (list[i].qty||0) + 1;
        else list.push({ productId:product.id, name:product.name, price:product.price, qty:1 });
        setCart(list);
        toast('カートに追加しました');
      });
    });
  }catch(e){
    console.error(e);
    const grid = $('#productsGrid'); if (grid) grid.innerHTML = `<div class="alert alert-danger" style="grid-column:1/-1;text-align:center">商品を読み込めませんでした</div>`;
  }
}
window.loadProducts = loadProducts;

/* ===== カート描画（#cartItems なければ #items 互換） ===== */
function cartContainer(){ return $('#cartItems') || $('#items') || null; }
function renderCartPage(){
  const wrap = cartContainer();
  const totalEl = $('#cartTotal') || $('#total');
  if (!wrap && !totalEl) return;

  const list = getCart();
  const total = list.reduce((s,i)=> s + (Math.round(Number(i.price)||0) * (Number(i.qty)||0)), 0);

  if (wrap){
    wrap.innerHTML = list.length ? list.map(i=>`
      <div class="cart-item">
        <div>
          <div class="title">${i.name||'商品'}</div>
          <div class="unit">単価: ${fmtJPY(i.price)}</div>
        </div>
        <div class="qty-wrap">
          <button class="qty-btn minus" data-id="${i.productId}">−</button>
          <span class="qty-pill">${i.qty}</span>
          <button class="qty-btn plus"  data-id="${i.productId}">＋</button>
        </div>
        <div class="product-price">${fmtJPY((Number(i.price)||0)*(Number(i.qty)||0))}</div>
        <button class="btn btn-danger" data-del="${i.productId}">削除</button>
      </div>
    `).join('') : `<div class="alert alert-info">カートは空です</div>`;

    $$('.qty-btn.minus', wrap).forEach(b=>b.addEventListener('click',e=>{
      const id = Number(e.currentTarget.dataset.id);
      const list = getCart(); const it = list.find(x=>x.productId===id); if(!it) return;
      it.qty = Math.max(1,(it.qty||1)-1); setCart(list);
    }));
    $$('.qty-btn.plus', wrap).forEach(b=>b.addEventListener('click',e=>{
      const id = Number(e.currentTarget.dataset.id);
      const list = getCart(); const it = list.find(x=>x.productId===id); if(!it) return;
      it.qty = (it.qty||1)+1; setCart(list);
    }));
    $$('[data-del]', wrap).forEach(b=>b.addEventListener('click',e=>{
      const id = Number(e.currentTarget.getAttribute('data-del'));
      const list = getCart().filter(i=>i.productId!==id); setCart(list);
    }));
  }
  if (totalEl) totalEl.textContent = fmtJPY(total);
}

/* ===== 検索 ===== */
function wireSearch(){
  const input = $('#searchInput'); const btn = $('#searchBtn'); if(!input||!btn) return;
  const exec = ()=>{
    const q = input.value.trim();
    if ($('#productsGrid')) loadProducts(q);
    else location.href = `./products.html?q=${encodeURIComponent(q)}`;
  };
  btn.addEventListener('click', exec);
  input.addEventListener('keydown', e=>{ if (e.key === 'Enter') exec(); });
}

/* ===== トースト ===== */
function toast(msg){
  let t = $('#toaster'); if(!t){ t=document.createElement('div'); t.id='toaster'; document.body.appendChild(t); }
  const n = document.createElement('div'); n.textContent = msg; t.appendChild(n);
  setTimeout(()=>{ n.remove(); }, 1500);
}
window.toast = window.toast || toast;         // 既存があれば再代入しない
window.updateCartBadge = updateCartBadge;

document.addEventListener('DOMContentLoaded', ()=>{
  clearGuestCartOnLogin();
  updateCartBadge();

  const q = new URLSearchParams(location.search).get('q') || '';
  if ($('#productsGrid')) loadProducts(q);
  if (cartContainer() || $('#cartTotal') || $('#total')) renderCartPage();
  wireSearch();

  // 他タブ同期
  window.addEventListener('storage', ev=>{
    if (ev.key && ev.key.startsWith('cart:')) { updateCartBadge(); renderCartPage(); }
    if (ev.key === 'auth_user' || ev.key === 'token') { clearGuestCartOnLogin(); updateCartBadge(); renderCartPage(); }
  });
});
// === 認証付き GET ヘルパ ===
async function apiAuthGet(url){
  const t = (window.Auth?.getToken?.() || '').trim();
  const r = await fetch(url, { headers: { ...(t ? {Authorization:`Bearer ${t}`} : {}) }});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// === 最近の注文をホームに描画 ===
async function loadRecentOrders(){
  const box = document.getElementById('recentOrders');
  const hint = document.getElementById('ordersHint');
  if (!box) return;

  // 未ログインなら案内だけ
  if (!(window.Auth?.isLoggedIn?.())) {
    box.innerHTML = `<div class="alert alert-info">ログインすると最近の注文が表示されます。</div>`;
    if (hint) hint.textContent = '';
    return;
  }

  try{
    const rows = await apiAuthGet('/api/my-orders?limit=5');
    if (!rows.length){
      box.innerHTML = `<div class="alert alert-info">まだ注文がありません。</div>`;
      if (hint) hint.textContent = '';
      return;
    }
    box.innerHTML = rows.map(o => {
      const dt = new Date(o.created_at || Date.now());
      const when = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      return `
        <div class="product-card" style="display:grid;grid-template-columns:1fr auto;gap:8px;">
          <div>
            <div style="font-weight:700;">注文ID: <span style="font-family:monospace">${o.orderId}</span></div>
            <div style="opacity:.85">${when}</div>
            <div style="margin-top:4px;">合計: <strong style="color:#34d399">${fmtJPY(o.total)}</strong>（小計 ${fmtJPY(o.subtotal)} / 税 ${fmtJPY(o.tax)}）</div>
            <div style="opacity:.8">支払: **** ${o.last4 || '****'}</div>
          </div>
          <div style="display:flex; align-items:center;">
            <a class="btn btn-secondary" href="./order-complete.html?ref=${encodeURIComponent(o.orderId)}">詳細</a>
          </div>
        </div>`;
    }).join('');
    if (hint) hint.textContent = '※ 直近5件まで表示しています。';
  }catch(e){
    console.error(e);
    box.innerHTML = `<div class="alert alert-danger">注文履歴を取得できませんでした。</div>`;
    if (hint) hint.textContent = '';
  }
}

// === 既存の DOMContentLoaded の末尾あたりに追加 ===
document.addEventListener('DOMContentLoaded', ()=>{
  // …既存の初期化処理…

  // ホームに「最近の注文」を出す
  loadRecentOrders();
});
