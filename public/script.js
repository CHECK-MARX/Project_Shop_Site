/* script.js — ナビ/商品/カート/ホーム小部品（Auth連携・管理ナビ・公開ベストセラー） */
(() => {
  'use strict';
  if (window.__APP_CORE_LOADED__) return;
  window.__APP_CORE_LOADED__ = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;
  window.$ = window.$ || $;
  window.$$ = window.$$ || $$;
  window.fmtJPY = window.fmtJPY || fmtJPY;

  // ==== Auth bridge ====
  const FallbackAuth = {
    getToken(){ return localStorage.getItem('token') || ''; },
    getUser(){
      try{ const raw = localStorage.getItem('auth_user'); return raw?JSON.parse(raw):null; }
      catch{ return null; }
    },
    isLoggedIn(){ return !!localStorage.getItem('token'); },
    openLogin(){
      const m = $('#loginModal');
      if (m){ m.classList.remove('hidden'); m.classList.add('open'); document.body.classList.add('modal-open'); }
    }
  };
  const Auth = (window.Auth ?? FallbackAuth);
  window.Auth = Auth;

  // ==== 認証付き fetch 共通化 ====
  function authHeaders(){ const t=(Auth.getToken?.()||'').trim(); return t?{Authorization:`Bearer ${t}`}:{ }; }
  async function fetchJSON(url, opts={}){
    const r = await fetch(url, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}), ...authHeaders() } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function apiAuthGet(url){ return fetchJSON(url); }
  window.apiAuthGet = window.apiAuthGet || apiAuthGet;
  window.authHeaders = window.authHeaders || authHeaders;
  window.fetchJSON   = window.fetchJSON   || fetchJSON;

  // ==== cart ====
  function cartKey(){ const u = Auth.getUser?.(); return `cart:${u?.username || 'guest'}`; }
  function getCart(){ try{ return JSON.parse(localStorage.getItem(cartKey())||'[]'); }catch{ return []; } }
  function setCart(list){ localStorage.setItem(cartKey(), JSON.stringify(list)); updateCartBadge(); renderCartPage(); }
  function updateCartBadge(){
    const badge = $('#cartCount'); if (!badge) return;
    const q = getCart().reduce((s,i)=> s + (Number(i.qty)||0), 0);
    if (q>0){ badge.style.display='inline-block'; badge.textContent=String(q); }
    else { badge.style.display='none'; badge.textContent='0'; }
  }
  function clearGuestCartOnLogin(){
    const u = Auth.getUser?.(); if (!u) return;
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
  function cartQtyOf(productId){ return getCart().reduce((s,i)=> s + (i.productId===productId ? (Number(i.qty)||0) : 0), 0); }
  function canAddOne(product){ const stock = Number(product.stock||0); if (!Number.isFinite(stock) || stock<=0) return false; return cartQtyOf(product.id) < stock; }

  // ==== AuthのUI ====
  function updateAuthUI(){
    const isIn   = !!(Auth.isLoggedIn?.());
    const user   = (Auth.getUser?.()) || null;
    const login  = document.getElementById('loginBtn');
    const reg    = document.getElementById('registerBtn');
    const logout = document.getElementById('logoutBtn');
    const pill   = document.getElementById('navUser');
    const prof   = document.getElementById('profileLink');
    if (login)  login.style.display  = isIn ? 'none'  : '';
    if (reg)    reg.style.display    = isIn ? 'none'  : '';
    if (logout) logout.style.display = isIn ? ''      : 'none';
    if (prof)   prof.style.display   = isIn ? ''      : 'none';
    if (pill) { if (isIn && user?.username) { pill.textContent = user.username; pill.hidden = false; } else { pill.hidden = true; pill.textContent = ''; } }
  }
  document.addEventListener('DOMContentLoaded', updateAuthUI);
  window.addEventListener('storage', (e)=>{ if (e.key === 'token' || e.key === 'auth_user') updateAuthUI(); });
  window.addEventListener('auth:changed', updateAuthUI);
  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{
    localStorage.removeItem('token'); localStorage.removeItem('auth_user');
    updateAuthUI(); location.href = './index.html';
  });

  // ==== products grid ====
  async function apiGet(url){ const r = await fetch(url); if(!r.ok) throw new Error(r.status); return r.json(); }
  async function loadProducts(search=''){
    try{
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      const items = await apiGet(`/api/products${qs}`);
      const grid = $('#productsGrid'); if (!grid) return;

      if (!items?.length){
        grid.innerHTML = `<div class="alert alert-info" style="grid-column:1/-1;text-align:center">商品が見つかりませんでした</div>`;
        return;
      }
      grid.innerHTML = items.map(p=>`
        <div class="product-card" data-id="${p.id}" data-name="${p.name}" data-price="${Math.round(Number(p.price)||0)}" data-stock="${Number(p.stock||0)}">
          <img class="product-img" src="${p.image_path || `https://picsum.photos/seed/p${p.id}/800/500`}" alt="${p.name}">
          <h3>${p.name}</h3>
          <p>${p.description || ''}</p>
          <div class="product-price">${fmtJPY(p.price)}</div>
          <div class="product-stock">在庫: ${Number(p.stock||0)}個</div>
          <button class="btn btn-primary add-to-cart">カートに追加</button>
        </div>`).join('');

      $$('.product-card', grid).forEach(card=>{
        const pid = Number(card.dataset.id);
        const stock = Number(card.dataset.stock)||0;
        const btn = $('.add-to-cart', card);
        if (!btn) return;
        if (stock<=0){ btn.disabled = true; btn.textContent = '在庫なし'; }
        else if (cartQtyOf(pid) >= stock){ btn.disabled = true; btn.textContent = '在庫上限'; }
      });

      $$('.add-to-cart', grid).forEach(btn=>{
        btn.addEventListener('click', e=>{
          const card = e.currentTarget.closest('.product-card');
          const product = { id:Number(card.dataset.id), name:card.dataset.name, price:Number(card.dataset.price)||0, stock:Number(card.dataset.stock)||0 };

          if (!Auth.isLoggedIn?.()){ toast('ログインするとカートに追加できます'); Auth.openLogin?.(); return; }
          if (!canAddOne(product)){ e.currentTarget.disabled = true; e.currentTarget.textContent = product.stock<=0 ? '在庫なし' : '在庫上限'; toast('在庫数を超えています'); return; }

          const list = getCart();
          const i = list.findIndex(x=>x.productId===product.id);
          if (i>=0) list[i].qty = Math.min(product.stock, (list[i].qty||0) + 1);
          else list.push({ productId:product.id, name:product.name, price:product.price, qty:1 });
          setCart(list);
          toast('カートに追加しました');
          if (!canAddOne(product)){ e.currentTarget.disabled = true; e.currentTarget.textContent = '在庫上限'; }
        });
      });
    }catch(e){
      console.error(e);
      const grid = $('#productsGrid'); if (grid) grid.innerHTML = `<div class="alert alert-danger" style="grid-column:1/-1;text-align:center">商品を読み込めませんでした</div>`;
    }
  }
  window.loadProducts = window.loadProducts || loadProducts;

  // ==== cart page ====
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
        </div>`).join('') : `<div class="alert alert-info">カートは空です</div>`;

      $$('.qty-btn.minus', wrap).forEach(b=>b.addEventListener('click',e=>{
        const id = Number(e.currentTarget.dataset.id);
        const list = getCart(); const it = list.find(x=>x.productId===id); if(!it) return;
        it.qty = Math.max(1,(it.qty||1)-1); setCart(list);
      }));

      $$('.qty-btn.plus', wrap).forEach(b=>b.addEventListener('click',async e=>{
        const id = Number(e.currentTarget.dataset.id);
        try{
          const p = await apiGet(`/api/product/${id}`);
          const stock = Number(p.stock||0);
          const list = getCart(); const it = list.find(x=>x.productId===id); if(!it) return;
          const cur = Number(it.qty||1);
          if (cur >= stock){ toast('在庫数を超えています'); return; }
          it.qty = cur + 1; setCart(list);
        }catch{
          const list = getCart(); const it = list.find(x=>x.productId===id); if(!it) return;
          it.qty = Math.min(999, (it.qty||1)+1); setCart(list);
        }
      }));

      $$('[data-del]', wrap).forEach(b=>b.addEventListener('click',e=>{
        const id = Number(e.currentTarget.getAttribute('data-del'));
        const list = getCart().filter(i=>i.productId!==id); setCart(list);
      }));
    }
    if (totalEl) totalEl.textContent = fmtJPY(total);
  }

  // ==== search ====
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

  function toast(msg){
    let t = $('#toaster'); if(!t){ t=document.createElement('div'); t.id='toaster'; document.body.appendChild(t); }
    const n = document.createElement('div'); n.textContent = msg; t.appendChild(n); setTimeout(()=>{ n.remove(); }, 1500);
  }
  window.toast = window.toast || toast;
  window.updateCartBadge = window.updateCartBadge || updateCartBadge;

  // ==== Admin ナビ ====
  async function fetchMe() {
    const t = Auth.getToken?.() || ''; if (!t) return null;
    try { const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${t}` } }); if (!r.ok) return null; const b = await r.json(); return b && b.user; }
    catch { return null; }
  }
  function renderAdminLinks(isAdmin) {
    const nav = document.querySelector('.nav-links'); if (!nav) return;
    document.getElementById('navInventory')?.remove();
    document.getElementById('navAdmin')?.remove();
    if (!isAdmin) return;
    const inv = document.createElement('a'); inv.id='navInventory'; inv.href='./inventory.html'; inv.textContent='在庫管理';
    const adm = document.createElement('a'); adm.id='navAdmin';    adm.href='./admin.html';     adm.textContent='管理ダッシュボード';
    const authBtns = document.querySelector('.auth-buttons'); const parent = authBtns?.parentElement;
    try{ if (authBtns && parent){ parent.insertBefore(adm, authBtns); parent.insertBefore(inv, authBtns); } else { nav.appendChild(adm); nav.appendChild(inv); } }
    catch{ nav.appendChild(adm); nav.appendChild(inv); }
  }
  async function updateAdminNav(){ try{ const me = await fetchMe(); renderAdminLinks(!!me && me.role==='admin'); }catch{} }
  window.updateAdminNav = window.updateAdminNav || updateAdminNav;

  // ==== ベストセラー ====
  async function loadBestsellers(limit=10){
    const wrap = document.getElementById('bestWrap'); const box = document.getElementById('bestList'); if (!wrap || !box) return;
    box.innerHTML = '';
    async function fetchPublic(){ const r = await fetch(`/api/bestsellers?limit=${encodeURIComponent(limit)}`); if(!r.ok) throw new Error(r.status); return r.json(); }
    async function fetchAdmin(){
      const t=(Auth.getToken?.()||'').trim(); if(!t) throw new Error('no token');
      const sales = await fetchJSON('/api/admin/sales-summary');
      const products = await (async()=>{ try{ return await (await fetch('/api/products')).json(); }catch{ return []; }})();
      const pmap = new Map(products.map(p=>[Number(p.id), p]));
      return sales.map(s=>{ const p=pmap.get(Number(s.product_id)); return p?{...p, sold:Number(s.sold)||0}:null; }).filter(Boolean)
                  .sort((a,b)=>(b.sold||0)-(a.sold||0)).slice(0,limit);
    }
    try{
      let data=[]; try{ data=await fetchPublic(); }catch{ data=await fetchAdmin(); }
      if (!data?.length){ wrap.style.display='none'; return; }
      box.innerHTML = data.map((p,i)=>{
        const img = p.image_path || `https://picsum.photos/seed/p${p.id}/600/380`;
        const sold = (p.sold ?? 0).toLocaleString('ja-JP'); const stock = Number(p.stock||0);
        return `<a class="best-card" href="./products.html?q=${encodeURIComponent(p.name)}" style="position:relative;">
          <span class="best-rank">${i+1}</span>
          <img src="${img}" alt="${p.name}"><div class="best-name">${p.name}</div>
          <div class="best-meta">売れた: <b>${sold}</b> ｜ 在庫: ${stock}</div></a>`;
      }).join('');
      wrap.style.display='';
    }catch{ wrap.style.display='none'; }
  }
  window.loadBestsellers = window.loadBestsellers || loadBestsellers;

  // ==== 最近の注文（ホーム） ====
  async function loadRecentOrders(){
    const box  = document.getElementById('recentOrders');
    const hint = document.getElementById('ordersHint');
    if (!box) return;
    if (!(Auth.isLoggedIn?.())){ box.innerHTML=`<div class="alert alert-info">ログインすると最近の注文が表示されます。</div>`; if (hint) hint.textContent=''; return; }
    try{
      const rows = await fetchJSON('/api/my-orders?limit=5');
      if (!rows.length){ box.innerHTML=`<div class="alert alert-info">まだ注文がありません。</div>`; if (hint) hint.textContent=''; return; }
      box.innerHTML = rows.map(o=>{
        const dt = new Date(o.created_at || Date.now());
        const pad = (n)=>String(n).padStart(2,'0');
        const when = `${dt.getFullYear()}/${pad(dt.getMonth()+1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        return `<div class="product-card" style="display:grid;grid-template-columns:1fr auto;gap:8px;">
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
    }catch{
      box.innerHTML = `<div class="alert alert-danger">注文履歴を取得できませんでした。</div>`; if (hint) hint.textContent='';
    }
  }

  // ==== init ====
  document.addEventListener('DOMContentLoaded', ()=>{
    clearGuestCartOnLogin();
    updateCartBadge();

    const q = new URLSearchParams(location.search).get('q')||'';
    if ($('#productsGrid')) loadProducts(q);
    if (cartContainer() || $('#cartTotal') || $('#total')) renderCartPage();
    (function wireSearch(){ const i=$('#searchInput'), b=$('#searchBtn'); if(!i||!b) return;
      const exec=()=>{ const q=i.value.trim(); if($('#productsGrid')) loadProducts(q); else location.href=`./products.html?q=${encodeURIComponent(q)}`; };
      b.addEventListener('click',exec); i.addEventListener('keydown',e=>{ if(e.key==='Enter') exec(); });
    })();

    updateAdminNav();
    loadRecentOrders();
    loadBestsellers(10);
  });

  // 他タブ同期
  window.addEventListener('storage', ev=>{
    if (ev.key && ev.key.startsWith('cart:')){ updateCartBadge(); renderCartPage(); if ($('#productsGrid')){ const q=new URLSearchParams(location.search).get('q')||''; loadProducts(q); } }
    if (ev.key === 'auth_user' || ev.key === 'token'){ clearGuestCartOnLogin(); updateCartBadge(); renderCartPage(); updateAdminNav(); }
  });
  window.addEventListener('focus', ()=> updateAdminNav());
  window.addEventListener('auth:changed', ()=> updateAdminNav());
})();
