(() => {
  // ===== 二重読込ガード =====
  if (window.__SHOP_SCRIPT_LOADED__) return;
  window.__SHOP_SCRIPT_LOADED__ = true;

  // ===== Utils =====
  const $id  = (id) => document.getElementById(id);
  const $qs  = (sel, root=document) => root.querySelector(sel);
  const jget = (k, fb=null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } };
  const jset = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const jdel = (k) => localStorage.removeItem(k);
  const num  = (v, d=0) => (v===null||v===undefined||v==='' ? d : Number(v));

  const isLoggedIn = () => {
    const token = localStorage.getItem('token');
    const user  = jget('user', null);
    return !!token && !!user && !!user.username;
  };

  const authToken = () => localStorage.getItem('token') || '';

  async function api(url){
    const r = await fetch(url);
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }
  async function apiAuth(url, opt={}){
    const r = await fetch(url, {
      ...opt,
      headers: {
        'Content-Type':'application/json',
        ...(opt.headers||{}),
        Authorization: `Bearer ${authToken()}`
      }
    });
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  // ===== Toast =====
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

  // ===== Modal =====
  function openModal(id){
    const el = $id(id);
    if (!el) return;
    el.classList.remove('hidden'); el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    el.querySelector('input,button,select,textarea')?.focus();
  }
  function closeModal(id){
    const el = $id(id);
    if (!el) return;
    el.classList.remove('open'); el.classList.add('hidden');
    el.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
  }
  window.openModal  = openModal;
  window.closeModal = closeModal;

  // ===== プロフィールキャッシュ =====
  const PROFILE_CACHE_KEY = '__me_profile';
  const setProfileCache = (p) => jset(PROFILE_CACHE_KEY, p||{});
  const getProfileCache = () => jget(PROFILE_CACHE_KEY, {});

  async function fetchMeAndCache(){
    if (!isLoggedIn()) { setProfileCache({}); return; }
    try{
      const me = await apiAuth('/api/me');
      setProfileCache(me?.profile || {});
      // email 更新が返ってきてたら user に反映（任意）
      const user = jget('user', null);
      if (user && me?.user?.username === user.username) {
        jset('user', { ...user, email: me?.user?.email });
      }
    }catch(e){
      // 認証切れ等は無視
    }
  }

  // ===== Cart (user-scoped mirror) =====
  const CART_KEY = 'cart';
  const getUser = () => jget('user', null);
  const userCartKey = (u) => `cart:user:${String(u?.username||'').toLowerCase()}`;

  const getCart = () => jget(CART_KEY, []);
  const setCart = (a) => {
    jset(CART_KEY, a);
    const u = getUser();
    if (u?.username) jset(userCartKey(u), a);
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

  // ===== Pending Add（未ログイン時に1件だけ保留）=====
  const PENDING_KEY = '__pendingAdd';
  const queuePendingAdd   = (info) => sessionStorage.setItem(PENDING_KEY, JSON.stringify(info));
  const consumePendingAdd = () => {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_KEY);
    try { const info = JSON.parse(raw); info && addToCartAny(info); } catch {}
  };

  // ===== Auth UI =====
  function displayNameOrUsername(){
    const user = getUser();
    const prof = getProfileCache();
    return (prof?.display_name && String(prof.display_name).trim()) || (user?.username || 'user');
  }

  function updateAuthUI(){
    const loggedIn = isLoggedIn();
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
        userPill.textContent = `👤 ${displayNameOrUsername()}`;
        userPill.removeAttribute('hidden');
        userPill.style.display = 'inline-flex';
      }
      profileLink && (profileLink.style.display='inline');

      restoreUserCartIfNeeded();
      closeModal('loginModal'); closeModal('registerModal');
      consumePendingAdd();
    } else {
      loginBtn    && (loginBtn.style.display='inline-block');
      registerBtn && (registerBtn.style.display='inline-block');
      logoutBtn   && (logoutBtn.style.display='none');
      if (userPill){
        userPill.textContent = '';
        userPill.setAttribute('hidden','');
        userPill.style.display='none';
      }
      profileLink && (profileLink.style.display='none');
    }
    updateCartBadge();
  }
  window.updateAuthUI = updateAuthUI;

  function logout(){
    const u = getUser();
    persistUserCart();
    if (u?.username) sessionStorage.removeItem(`__restored:${u.username}`);

    clearCart();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setProfileCache({});

    updateAuthUI();
    showToast('ログアウトしました');
    try { if (!location.pathname.endsWith('/index.html')) location.href = './index.html'; } catch {}
  }
  window.logout = logout;

  // ===== Add to cart（未ログインはブロックしてログイン誘導）=====
  const getPid = (it) => num(it?.id ?? it?.productId, NaN);

  async function addToCartAny(arg){
    if (!isLoggedIn()){
      let pid, name='', price=0;
      if (typeof arg === 'object' && arg){
        pid   = num(arg.id ?? arg.productId);
        name  = arg.name  || '';
        price = num(arg.price, 0);
      } else { pid = num(arg); }
      queuePendingAdd({ id: pid, name, price });
      showToast('ログイン後にカートへ追加します');
      openModal('loginModal');
      return;
    }

    let pid, name='', price=0;
    if (typeof arg === 'object' && arg){
      pid   = num(arg.id ?? arg.productId);
      name  = arg.name  || '';
      price = num(arg.price, 0);
    } else { pid = num(arg); }
    if (!Number.isFinite(pid)) return;

    if (!name || !price){
      try{
        const p = await api(`/api/product/${pid}`);
        name  ||= p.name || '';
        price ||= num(p.price, 0);
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

  // ===== Badge =====
  function updateCartBadge(){
    const el = $id('cartCount');
    if (!el) return;
    const total = getCart().reduce((s,i)=> s + num(i.qty ?? i.quantity, 0), 0);
    el.textContent = String(total);
    el.style.display = total>0 ? 'inline-block' : 'none';
  }

  // ===== Products list（products.html）=====
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
        img.className='product-img'; img.alt = p.name || 'product';
        img.src = p.image_path || `https://picsum.photos/seed/p${p.id}/600/380`;

        const h3 = document.createElement('h3'); h3.textContent = p.name;
        const ds = document.createElement('p');  ds.textContent = p.description || '';
        const pr = document.createElement('div'); pr.className='product-price'; pr.textContent = `¥${p.price}`;
        const st = document.createElement('div'); st.className='product-stock'; st.textContent = `在庫: ${p.stock}個`;

        const btn = document.createElement('button');
        btn.className='btn btn-primary add-to-cart'; btn.type='button'; btn.textContent='カートに追加';
        btn.dataset.productId = p.id; btn.dataset.name  = p.name; btn.dataset.price = p.price;

        card.append(img,h3,ds,pr,st,btn);
        grid.appendChild(card);
      });
    }catch(e){
      console.error(e);
      showToast('商品取得に失敗しました', 1800);
    }
  }
  window.loadProducts = loadProducts;

  // ===== クリック委譲（Close / Add to Cart）=====
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('#loginClose'))    return closeModal('loginModal');
    if (t.closest('#registerClose')) return closeModal('registerModal');

    const btn = t.closest('[data-add],[data-product-id],[data-id],.add-to-cart,button');
    if (!btn) return;
    const label = (btn.textContent||'').trim();
    const isAdd = btn.matches('[data-add],[data-product-id],[data-id],.add-to-cart') || /カートに追加|Add to Cart/i.test(label);
    if (!isAdd) return;

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
  });

  // ===== プロフィール保存（/profile.html 等）=====
  const PROFILE_FIELDS = [
    'display_name','full_name','phone','birthday','website','bio','avatar_url',
    'address1','address2','city','state','zip','country','language','timezone',
    'newsletter','twitter','email'
  ];

  function getFieldValue(name){
    // 優先度: [name=] → #pf_name → #name
    const byName = $qs(`[name="${name}"]`);
    const pfId   = $id(`pf_${name}`);
    const byId   = $id(name);
    const el = byName || pfId || byId;
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked ? 1 : 0;
    return el.value ?? null;
  }
  function collectProfileFromForm(){
    const p = {};
    PROFILE_FIELDS.forEach(k => {
      const v = getFieldValue(k);
      if (v !== null) p[k] = v;
    });
    return p;
  }

  async function saveProfile(){
    if (!isLoggedIn()){ openModal('loginModal'); return; }
    try{
      const payload = collectProfileFromForm();
      await apiAuth('/api/me', {
        method:'PUT',
        body: JSON.stringify(payload)
      });
      // 再取得してキャッシュ更新（確実）
      await fetchMeAndCache();
      updateAuthUI(); // display_name 反映
      showToast('プロフィールを保存しました');
    }catch(e){
      showToast(`保存に失敗: ${e.message || e}`, 2000);
    }
  }

  // フォーム/ボタン配線（存在するページだけ動く）
  function wireProfilePage(){
    const form = $id('profileForm');
    const btn  = $id('profileSave');
    if (form){
      form.addEventListener('submit', (e)=>{ e.preventDefault(); saveProfile(); });
    }
    if (btn){
      btn.addEventListener('click', (e)=>{ e.preventDefault?.(); saveProfile(); });
    }
  }

  // ===== Auth change watcher =====
  let _lastToken = localStorage.getItem('token') || null;
  let _lastUser  = (getUser()?.username) || null;
  setInterval(async () => {
    const tok = localStorage.getItem('token') || null;
    const usr = (getUser()?.username) || null;
    if (tok !== _lastToken || usr !== _lastUser) {
      _lastToken = tok;
      _lastUser  = usr;
      if (tok && usr) await fetchMeAndCache(); // ログイン切替で最新を取得
      updateAuthUI();
    }
  }, 700);

  // ===== Boot =====
  document.addEventListener('DOMContentLoaded', async ()=>{
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

    wireProfilePage();

    if (isLoggedIn()) await fetchMeAndCache();
    updateAuthUI();
    loadProducts(); // products.html のときのみ効く
  });
})();
