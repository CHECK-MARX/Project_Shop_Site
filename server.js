// public/script.js
(() => {
  // ===== 基本ユーティリティ =====
  const $id = (id) => document.getElementById(id);

  // ===== モーダル制御 =====
  function openModal(id) {
    const el = $id(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('open');
    el.style.display = 'grid';
    el.querySelector('.modal-content')?.focus();
    document.body.classList.add('modal-open');
  }
  function closeModal(id) {
    const el = $id(id);
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
  window.openModal  = openModal;
  window.closeModal = closeModal;

  // ===== 認証状態ヘルパ =====
  function getStoredUser() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function updateAuthUI() {
    const token    = localStorage.getItem('token');
    const user     = getStoredUser();
    const loggedIn = !!token && !!user;

    const loginBtn    = $id('loginBtn');
    const registerBtn = $id('registerBtn');
    const logoutBtn   = $id('logoutBtn');
    const adminSec    = $id('adminSection');   // あれば使う（無くてもOK）
    const userPill    = $id('navUser');
    const profileLink = $id('profileLink');    // ★ 追加：プロフィールリンク

    if (loggedIn) {
      if (loginBtn)    loginBtn.style.display    = 'none';
      if (registerBtn) registerBtn.style.display = 'none';
      if (logoutBtn)   logoutBtn.style.display   = 'inline-block';
      if (adminSec)    adminSec.style.display    = (user.role === 'admin') ? 'block' : 'none';
      if (userPill) {
        userPill.textContent = `👤 ${user.username || 'user'}`;
        userPill.removeAttribute('hidden');
        userPill.style.display = 'inline-flex';
      }
      // ★ ログイン時はプロフィールを見せる
      if (profileLink) profileLink.style.display = 'inline';
    } else {
      if (loginBtn)    loginBtn.style.display    = 'inline-block';
      if (registerBtn) registerBtn.style.display = 'inline-block';
      if (logoutBtn)   logoutBtn.style.display   = 'none';
      if (adminSec)    adminSec.style.display    = 'none';
      if (userPill) {
        userPill.textContent = '';
        userPill.setAttribute('hidden', '');
        userPill.style.display = 'none';
      }
      // ★ 未ログイン時は隠す
      if (profileLink) profileLink.style.display = 'none';
    }
  }
  window.updateAuthUI = updateAuthUI;

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateAuthUI();
    alert('ログアウトしました');
    // 好みでトップへ戻す
    try { if (!location.pathname.endsWith('/index.html')) location.href = './index.html'; } catch {}
  }
  window.logout = logout;

  // ===== API 共通 =====
  async function api(url, opt = {}) {
    const token = localStorage.getItem('token');
    const r = await fetch(url, {
      ...opt,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opt.headers || {}),
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `${r.status}`);
    return data;
  }

  // ===== 商品表示 =====
  let cart = []; // （ここでは UI だけ。保存は他ページで）

  async function loadProducts(search = '') {
    const grid = $id('productsGrid');
    if (!grid) return;
    try {
      const url = search
        ? `/api/products?search=${encodeURIComponent(search)}`
        : '/api/products';
      const products = await api(url);

      grid.innerHTML = '';
      for (const p of products) {
        const card = document.createElement('div');
        card.className = 'product-card';

        const h3 = document.createElement('h3'); h3.textContent = p.name;
        const desc = document.createElement('p'); desc.textContent = p.description;
        const pr = document.createElement('div'); pr.className = 'product-price'; pr.textContent = `¥${p.price}`;
        const st = document.createElement('div'); st.className = 'product-stock'; st.textContent = `在庫: ${p.stock}個`;
        const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.type='button'; btn.textContent = 'カートに追加';
        btn.addEventListener('click', () => addToCart(p.id));

        card.append(h3, desc, pr, st, btn);
        grid.appendChild(card);
      }
    } catch (e) {
      console.error(e);
      alert('商品取得に失敗しました');
    }
  }
  window.loadProducts = loadProducts;

  function addToCart(productId) {
    const found = cart.find(i => i.productId === productId);
    if (found) found.quantity += 1;
    else cart.push({ productId, quantity: 1 });
    alert('カートに追加しました');
  }
  window.addToCart = addToCart;

  // ===== 起動処理 =====
  document.addEventListener('DOMContentLoaded', () => {
    // モーダル確実に閉じる
    closeModal('loginModal');
    closeModal('registerModal');

    // モーダル開閉ボタン
    $id('loginBtn')?.addEventListener('click', () => openModal('loginModal'));
    $id('registerBtn')?.addEventListener('click', () => openModal('registerModal'));
    $id('logoutBtn')?.addEventListener('click', logout);
    $id('loginClose')?.addEventListener('click', () => closeModal('loginModal'));
    $id('registerClose')?.addEventListener('click', () => closeModal('registerModal'));

    // 背景クリックで閉じる
    window.addEventListener('click', (e) => {
      if (e.target.classList?.contains('modal')) closeModal(e.target.id);
    });

    // 検索（products.html）
    $id('searchBtn')?.addEventListener('click', () => {
      const term = $id('searchInput')?.value || '';
      loadProducts(term);
    });
    $id('searchInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loadProducts(e.currentTarget.value || '');
    });

    // 初期UI
    updateAuthUI();
    loadProducts(); // productsGrid があるページだけ動く
  });
})();
