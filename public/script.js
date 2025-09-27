(() => {
  // ===== 二重読込ガード =====
  if (window.__SHOP_SCRIPT_LOADED__) return;
  window.__SHOP_SCRIPT_LOADED__ = true;

  // ===== 小ユーティリティ =====
  const $id  = (id) => document.getElementById(id);
  const jget = (k, fb=null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } };
  const jset = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const jdel = (k) => localStorage.removeItem(k);
  const num  = (v, d=0) => (v===null||v===undefined||v==='' ? d : Number(v));

  // ===== 非ブロッキング・トースト =====
  function showToast(msg, ms=1400) {
    let host = $id('toaster');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toaster';
      host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText =
      'max-width:90vw;padding:10px 14px;border-radius:10px;border:1px solid #2b3a5a;'
      +'background:#0f1729;color:#e9edf6;box-shadow:0 6px 24px rgba(0,0,0,.35);font-weight:600;';
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ===== モーダル =====
  function openModal(id){
    const el = $id(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    el.querySelector('input,button,select,textarea')?.focus();
  }
  function closeModal(id){
    const el = $id(id);
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('hidden');
    el.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
  }
  // ★ auth.js から呼べるよう公開
  window.openModal  = openModal;
  window.closeModal = closeModal;

  // ===== カート（ユーザ別に保存）=====
  const CART_KEY = 'cart';
  const getUser = () => jget('user', null);
  const userCartKey = (u) => `cart:user:${String(u?.username||'').toLowerCase()}`;

  const getCart = () => jget(CART_KEY, []);
  const setCart = (a) => {
    jset(CART_KEY, a);
    const u = getUser();
    if (u?.username) jset(userCartKey(u), a); // ログイン中はユーザ別にもミラー
    updateCartBadge();
  };
  const clearCart = () => { jdel(CART_KEY); updateCartBadge(); try { window.renderCart && window.renderCart(); } catch{} };

  function persistUserCart() {
    const u = getUser();
    if (!u?.username) return;
    jset(userCartKey(u), getCart());
  }
  function restoreUserCartIfNeeded() {
    const u = getUser();
    if (!u?.username) return;
    const flag = `__restored:${u.username}`;
    if (sessionStorage.getItem(flag)) return;
    const saved = jget(userCartKey(u), []);
    jset(CART_KEY, saved || []);
    sessionStorage.setItem(flag, '1');
    updateCartBadge();
    try { window.renderCart && window.renderCart(); } catch {}
  }

  // ===== 認証UI =====
  function updateAuthUI(){
    const token = localStorage.getItem('token');
    const user  = getUser();
    const loggedIn = !!token && !!user;

    const loginBtn    = $id('loginBtn');
    const registerBtn = $id('registerBtn');
    const logoutBtn   = $id('logoutBtn');
    const userPill    = $id('navUser');
    const profileLink = $id('profileLink');

    if (loggedIn){
      loginBtn    && (loginBtn.style.display='none');
      registerBtn && (registerBtn.style.display='none');
      logoutBtn   && (logoutBtn.style.display='inline-block');
      if (userPill){
        userPill.textContent = `👤 ${user.username || 'user'}`;
        userPill.removeAttribute('hidden');
        userPill.style.display = 'inline-flex';
      }
      profileLink && (profileLink.style.display='inline');

      // ★ ログイン時：ユーザ別カートを復元
      restoreUserCartIfNeeded();

      // ★ ログイン成功後は常にモーダルを閉じる（auth.js が呼ばなくても閉じる）
      closeModal('loginModal');
      closeModal('registerModal');
    } else {
      loginBtn    && (loginBtn.style.display='inline-block');
      registerBtn && (registerBtn.style.display='inline-block');
      logoutBtn   && (logoutBtn.style.display='none');
      if (userPill){
        userPill.textContent='';
        userPill.setAttribute('hidden','');
        userPill.style.display='none';
      }
      profileLink && (profileLink.style.display='none');
    }
    updateCartBadge();
  }
  window.updateAuthUI = updateAuthUI;

  function logout(){
    // 退避＆復元フラグクリア
    const u = getUser();
    persistUserCart();
    if (u?.username) sessionStorage.removeItem(`__restored:${u.username}`);

    clearCart();
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    updateAuthUI();
    showToast('ログアウトしました');
    try { if (!location.pathname.endsWith('/index.html')) location.href = './index.html'; } catch {}
  }
  window.logout = logout;

  // ===== カート追加 =====
  const getPid = (it) => num(it?.id ?? it?.productId, NaN);

  async function addToCartAny(arg){
    let pid, name='', price=0;
    if (typeof arg === 'object' && arg){
      pid   = num(arg.id ?? arg.productId);
      name  = arg.name  || '';
      price = num(arg.price, 0);
    } else {
      pid = num(arg);
    }
    if (!Number.isFinite(pid)) return;

    if (!name || !price){
      try{
        const r = await fetch(`/api/product/${pid}`);
        if (r.ok){
          const p = await r.json();
          name  ||= p.name || '';
          price ||= num(p.price, 0);
        }
      }catch{}
    }

    const cart = getCart();
    const idx = cart.findIndex(x => getPid(x) === pid);
    if (idx >= 0){
      const cur = cart[idx];
      const q = num(cur.qty ?? cur.quantity, 0) + 1;
      cart[idx] = { id: pid, productId: pid, name: name || cur.name || `#${pid}`, price: num(price || cur.price, 0), qty: q, quantity: q };
    } else {
      cart.push({ id: pid, productId: pid, name: name || `#${pid}`, price: num(price, 0), qty: 1, quantity: 1 });
    }
    setCart(cart);
    showToast('カートに追加しました');
    try { window.renderCart && window.renderCart(); } catch {}
  }
  window.addToCart     = (id)=>addToCartAny(id);
  window.addToCartById = (id)=>addToCartAny(id);

  // ===== バッジ =====
  function updateCartBadge(){
    const el = $id('cartCount');
    if (!el) return;
    const total = getCart().reduce((s,i)=> s + num(i.qty ?? i.quantity, 0), 0);
    el.textContent = String(total);
    el.style.display = total>0 ? 'inline-block' : 'none';
  }

  // ===== 商品一覧描画（products.html 用）=====
  async function api(url){
    const r = await fetch(url);
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

        const h3 = document.createElement('h3'); h3.textContent = p.name;
        const ds = document.createElement('p');  ds.textContent = p.description || '';
        const pr = document.createElement('div'); pr.className='product-price'; pr.textContent = `¥${p.price}`;
        const st = document.createElement('div'); st.className='product-stock'; st.textContent = `在庫: ${p.stock}個`;

        const btn = document.createElement('button');
        btn.className='btn btn-primary add-to-cart';
        btn.type='button';
        btn.textContent='カートに追加';
        btn.dataset.productId = p.id;
        btn.dataset.name  = p.name;
        btn.dataset.price = p.price;

        card.append(img,h3,ds,pr,st,btn);
        grid.appendChild(card);
      });
    }catch(e){
      console.error(e);
      showToast('商品取得に失敗しました', 1800);
    }
  }
  window.loadProducts = loadProducts;

  // ===== クリック委譲（add-to-cart / モーダル閉）=====
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('#loginClose'))    return closeModal('loginModal');
    if (t.closest('#registerClose')) return closeModal('registerModal');

    const btn = t.closest('[data-add],[data-product-id],[data-id],.add-to-cart,button');
    if (btn){
      const label = (btn.textContent||'').trim();
      if (!(btn.matches('[data-add],[data-product-id],[data-id],.add-to-cart') || /カートに追加|Add to Cart/i.test(label))) return;

      if (btn.__cartHandling) return;
      btn.__cartHandling = true;

      let id    = btn.dataset.id || btn.dataset.productId;
      let name  = btn.dataset.name;
      let price = btn.dataset.price;

      if (!id){
        const card = btn.closest('.product-card');
        id    = card?.dataset?.id;
        name  = name  || card?.dataset?.name  || card?.querySelector('h3')?.textContent?.trim();
        price = price || card?.dataset?.price || (card?.querySelector('.product-price')?.textContent||'').replace(/[^\d.]/g,'');
      }
      addToCartAny({ id, name, price }).finally(()=> { btn.__cartHandling = false; });
    }
  });

  // ===== 認証状態ウォッチャ（保険）=====
  let _lastToken = localStorage.getItem('token') || null;
  let _lastUser  = (getUser()?.username) || null;
  setInterval(() => {
    const tok = localStorage.getItem('token') || null;
    const usr = (getUser()?.username) || null;
    if (tok !== _lastToken || usr !== _lastUser) {
      _lastToken = tok;
      _lastUser  = usr;
      updateAuthUI(); // ログイン時はここでモーダルも閉じる
    }
  }, 700);

  // ===== 起動配線 =====
  document.addEventListener('DOMContentLoaded', ()=>{
    $id('loginBtn')?.addEventListener('click', ()=> openModal('loginModal'));
    $id('registerBtn')?.addEventListener('click', ()=> openModal('registerModal'));
    $id('logoutBtn')?.addEventListener('click', logout);

    window.addEventListener('click', (e)=>{
      const m = e.target;
      if (m?.classList?.contains('modal')) closeModal(m.id);
    });

    $id('searchBtn')?.addEventListener('click', ()=>{
      const term = $id('searchInput')?.value || '';
      loadProducts(term);
    });
    $id('searchInput')?.addEventListener('keypress', (e)=>{
      if (e.key === 'Enter') loadProducts(e.currentTarget.value || '');
    });

    updateAuthUI();
    loadProducts();
  });
})();
