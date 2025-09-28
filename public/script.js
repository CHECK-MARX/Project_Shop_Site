/* public/script.js — single-file UI core
   - 二重読込ガード
   - モーダル open/close をグローバル化
   - 認証UI更新（display_name 優先表示）
   - 未ログイン時はカート追加をブロック→ログインモーダル表示→成功後に自動追加
   - カートはユーザー別保存：cart:<userId>（ゲストは cart:guest）。互換の 'cart' にもミラー。
   - products 一覧描画（data属性付き）
   - cart.html での描画関数 window.renderCart を提供
*/

(() => {
  if (window.__SHOP_SCRIPT_LOADED__) return;
  window.__SHOP_SCRIPT_LOADED__ = true;

  // ---------- global tiny CSS patch (nav をブロックする要素対策) ----------
  try {
    const style = document.createElement('style');
    style.textContent = `
      #toaster{ pointer-events:none !important; }
      .modal.hidden,
      .modal[aria-hidden="true"],
      .modal:not(.open){ display:none !important; pointer-events:none !important; }
    `;
    document.head.appendChild(style);
  } catch {}

  // ---------- small utils ----------
  const $id  = (id) => document.getElementById(id);
  const $qs  = (sel) => document.querySelector(sel);
  const jget = (k, fb=null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } };
  const jset = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const num  = (v, d=0) => (v===null||v===undefined||v==='' ? d : Number(v));
  const has  = (v) => v !== null && v !== undefined;

  // ---------- toaster (non-blocking) ----------
  function toast(msg, ms=1300) {
    let host = $id('toaster');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toaster';
      host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px;pointer-events:none;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'max-width:90vw;padding:10px 14px;border-radius:10px;border:1px solid #2b3a5a;background:#0f1729;color:#e9edf6;box-shadow:0 6px 24px rgba(0,0,0,.35);font-weight:600;';
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- modal ----------
  function openModal(id) {
    const el = $id(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    el.querySelector('input,button,select,textarea')?.focus();
  }
  function closeModal(id) {
    const el = $id(id);
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('hidden');
    el.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
  }
  window.openModal = openModal;
  window.closeModal = closeModal;

  // 背景クリックで閉じる
  window.addEventListener('click', (e)=>{
    const m = e.target;
    if (m?.classList?.contains('modal')) closeModal(m.id);
  });

  // ---------- auth UI ----------
  function currentUser(){
    return jget('user', null);
  }
  function loggedIn(){
    return !!localStorage.getItem('token') && !!currentUser();
  }

  // display_name が保存されている場合はナビの表示名を差し替え
  function updateAuthUI() {
    const isIn  = loggedIn();
    const user  = currentUser();
    const loginBtn    = $id('loginBtn');
    const registerBtn = $id('registerBtn');
    const logoutBtn   = $id('logoutBtn');
    const userPill    = $id('navUser');
    const profileLink = $id('profileLink');

    if (isIn) {
      loginBtn    && (loginBtn.style.display='none');
      registerBtn && (registerBtn.style.display='none');
      logoutBtn   && (logoutBtn.style.display='inline-block');

      // /api/me を軽く叩いて display_name があれば表示（失敗時は従来名）
      const baseName = user?.username || 'user';
      (async () => {
        let label = baseName;
        try{
          const r = await fetch('/api/me', { headers:{ Authorization: 'Bearer '+localStorage.getItem('token') }});
          if (r.ok){
            const data = await r.json();
            const dn = data?.profile?.display_name;
            if (dn && String(dn).trim()) label = String(dn).trim();
          }
        }catch{}
        if (userPill){
          userPill.textContent = `👤 ${label}`;
          userPill.hidden = false;
          userPill.style.display = 'inline-flex';
        }
      })();

      profileLink && (profileLink.style.display='inline');
    } else {
      loginBtn    && (loginBtn.style.display='inline-block');
      registerBtn && (registerBtn.style.display='inline-block');
      logoutBtn   && (logoutBtn.style.display='none');
      if (userPill){ userPill.textContent=''; userPill.hidden=true; userPill.style.display='none'; }
      profileLink && (profileLink.style.display='none');
    }
    updateCartBadge();
  }
  window.updateAuthUI = updateAuthUI;

  // ---------- cart storage (user-scoped) ----------
  const BASE_GUEST = 'cart:guest';
  function activeCartKey(){
    const u = currentUser();
    return u && has(u.id) ? `cart:${u.id}` : BASE_GUEST;
  }
  // 互換の 'cart' にもミラーしておく（古いコード対策）
  function loadCart(){
    const key = activeCartKey();
    const arr = jget(key, []);
    jset('cart', arr);
    return arr;
  }
  function saveCart(arr){
    const key = activeCartKey();
    jset(key, arr);
    jset('cart', arr);
    updateCartBadge();
  }
  function clearActiveCart(){
    const key = activeCartKey();
    localStorage.removeItem(key);
    localStorage.removeItem('cart');
    updateCartBadge();
  }

  function updateCartBadge(){
    const el = $id('cartCount');
    if (!el) return;
    const arr = loadCart();
    const total = arr.reduce((s,i)=> s + num(i.qty ?? i.quantity, 0), 0);
    el.textContent = String(total);
    el.style.display = total>0 ? 'inline-block' : 'none';
  }

  // ---------- add to cart with login gate ----------
  const pidOf = (it) => num(it?.id ?? it?.productId, NaN);
  let pendingAdd = null;

  async function addToCartAny(arg){
    // 未ログインならログインモーダルを出し、成功後に自動追加
    if (!loggedIn()){
      const info = normalizeAddArg(arg);
      if (!Number.isFinite(info.id)) return;
      pendingAdd = info;
      openModal('loginModal');
      // モーダルが閉じられたらトークン存在を確認
      const modal = $id('loginModal');
      if (modal){
        const obs = new MutationObserver(()=> {
          const hidden = modal.classList.contains('hidden') || !modal.classList.contains('open');
          if (hidden) {
            obs.disconnect();
            if (loggedIn() && pendingAdd) {
              addToCartAfterLogin(pendingAdd);
            } else {
              toast('ログイン後にもう一度追加してください', 1500);
            }
            pendingAdd = null;
          }
        });
        obs.observe(modal, { attributes:true, attributeFilter:['class'] });
      }
      return;
    }

    // ログイン済み → 通常追加
    const info = normalizeAddArg(arg);
    if (!Number.isFinite(info.id)) return;
    // name/price がなければAPIで補完
    if (!info.name || !info.price){
      try{
        const r = await fetch(`/api/product/${info.id}`);
        if (r.ok){
          const p = await r.json();
          info.name  ||= p.name || (`#${info.id}`);
          info.price ||= num(p.price, 0);
        }
      }catch{}
    }
    applyCartAdd(info);
  }

  function addToCartAfterLogin(info){
    applyCartAdd(info);
  }

  function normalizeAddArg(arg){
    if (typeof arg === 'object' && arg){
      return {
        id: num(arg.id ?? arg.productId),
        name: arg.name || '',
        price: num(arg.price, 0)
      };
    }
    return { id: num(arg), name: '', price: 0 };
  }

  function applyCartAdd(info){
    const cart = loadCart();
    const idx = cart.findIndex(x => pidOf(x) === info.id);
    if (idx >= 0){
      const cur = cart[idx];
      const q = num(cur.qty ?? cur.quantity, 0) + 1;
      cart[idx] = {
        id: info.id, productId: info.id,
        name: info.name || cur.name || `#${info.id}`,
        price: num(info.price || cur.price, 0),
        qty: q, quantity: q
      };
    } else {
      cart.push({
        id: info.id, productId: info.id,
        name: info.name || `#${info.id}`,
        price: num(info.price, 0),
        qty: 1, quantity: 1
      });
    }
    saveCart(cart);
    toast('カートに追加しました');
    try { window.renderCart && window.renderCart(); } catch {}
  }

  window.addToCart = (id)=>addToCartAny(id);
  window.addToCartById = (id)=>addToCartAny(id);

  // ボタンクリック委譲（data-* / .add-to-cart 両対応、二重ガード）
  document.addEventListener('click', (ev) => {
    // ナビの a タグは完全スルー（ページ遷移を妨げない）
    if (ev.target.closest('a')) return;

    const btn = ev.target.closest('[data-add],[data-product-id],[data-id],.add-to-cart');
    if (!btn) return;
    if (btn.__cartHandling) return;
    btn.__cartHandling = true;

    const host  = btn.closest('[data-id],[data-product-id]') || btn;
    const id    = host.dataset.id || host.dataset.productId;
    const name  = host.dataset.name;
    const price = host.dataset.price;

    addToCartAny({ id, name, price }).finally(()=> { btn.__cartHandling = false; });
  });

  // ---------- products page: load & render ----------
  async function api(url){
    const r = await fetch(url, { cache:'no-store' });
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  async function loadProducts(search=''){
    const grid = $id('productsGrid');
    if (!grid) return;
    try{
      const url = search ? `/api/products?search=${encodeURIComponent(search)}` : '/api/products';
      const list = await api(url);
      grid.innerHTML = '';
      list.forEach(p=>{
        const card = document.createElement('div');
        card.className = 'product-card';
        card.dataset.id    = p.id;
        card.dataset.name  = p.name;
        card.dataset.price = p.price;

        const img = document.createElement('img');
        img.className='product-img';
        img.alt = p.name || 'product';
        img.src = p.image_path || `https://picsum.photos/seed/p${p.id}/600/380`;

        const h3=document.createElement('h3'); h3.textContent = p.name || '';
        const ds=document.createElement('p'); ds.textContent = p.description || '';
        const pr=document.createElement('div'); pr.className='product-price'; pr.textContent = `¥${Number(p.price).toFixed(2)}`;
        const st=document.createElement('div'); st.className='product-stock'; st.textContent = `在庫: ${p.stock ?? 0}個`;

        const btn=document.createElement('button');
        btn.className='btn btn-primary add-to-cart';
        btn.type='button';
        btn.textContent='カートに追加';
        btn.dataset.productId = p.id;
        btn.dataset.name  = p.name || '';
        btn.dataset.price = p.price ?? 0;

        card.append(img,h3,ds,pr,st,btn);
        grid.appendChild(card);
      });
    }catch(e){
      console.error(e);
      // フェイルセーフ、最低限は文字で見せる
      $id('productsGrid').innerHTML = '<p style="color:#ff8888">商品取得に失敗しました</p>';
    }
  }
  window.loadProducts = loadProducts;

  // 検索UI
  $id('searchBtn')?.addEventListener('click', ()=>{
    const term = $id('searchInput')?.value || '';
    loadProducts(term);
  });
  $id('searchInput')?.addEventListener('keypress', (e)=>{
    if (e.key==='Enter') loadProducts(e.currentTarget.value || '');
  });

  // ---------- cart.html render ----------
  async function fetchProduct(id){
    const r = await fetch(`/api/product/${id}`);
    if(!r.ok) throw new Error('商品取得に失敗');
    return r.json();
  }

  async function renderCart(){
    const itemsDiv = $id('items') || $id('cartItems'); // cart.html / index.html 互換
    const totalEl  = $id('total') || $id('cartTotal');
    if (!itemsDiv || !totalEl) return;

    const cart = loadCart();
    if(cart.length===0){
      itemsDiv.innerHTML = '<p>カートは空です</p>';
      totalEl.textContent = '¥0';
      return;
    }

    let total = 0;
    let html  = '';

    for(const it of cart){
      try{
        const pid = pidOf(it);
        const p = await fetchProduct(pid);
        const qty = num(it.qty ?? it.quantity, 0);
        const price = num(p.price ?? it.price, 0);
        const t = price * qty;
        total  += t;

        html += `
          <div class="cart-item">
            <div>
              <h4>${p.name}</h4>
              <p>数量: ${qty}</p>
            </div>
            <div>
              <span class="product-price">¥${t.toFixed(2)}</span>
              <button class="btn btn-danger" onclick="rmItem(${pid})">削除</button>
            </div>
          </div>`;
      }catch(e){
        console.error(e);
      }
    }

    itemsDiv.innerHTML  = html || '<p>カートの読み込みに失敗しました</p>';
    totalEl.textContent = '¥' + total.toFixed(2);
  }
  window.renderCart = renderCart;

  function rmItem(id){
    const next = loadCart().filter(i => pidOf(i) !== Number(id));
    saveCart(next);
    renderCart();
  }
  window.rmItem = rmItem;

  // ---------- wire top buttons if present ----------
  $id('loginBtn')?.addEventListener('click', ()=> openModal('loginModal'));
  $id('registerBtn')?.addEventListener('click', ()=> openModal('registerModal'));
  $id('logoutBtn')?.addEventListener('click', ()=>{
    // ログアウト時：そのユーザーのカートをクリアし、ゲストに切り替わる
    clearActiveCart();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateAuthUI();
    toast('ログアウトしました');
    try { if (!location.pathname.endsWith('/index.html')) location.href = './index.html'; } catch {}
  });

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', ()=>{
    updateAuthUI();
    // products.html のときだけ描画される（grid が無いページでは何もしない）
    if ($id('productsGrid')) loadProducts('');
    // cart ページなら描画
    if ($id('items') || $id('cartItems')) renderCart();
  });
})();
