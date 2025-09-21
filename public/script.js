// public/script.js
(() => {
  // ===== util =====
  const $id = (id) => document.getElementById(id);
  document.getElementById('viewUsersBtn')?.addEventListener('click', () => {
    location.href = './admin.html';
  });
  
  // ===== モーダル（既存のまま） =====
  function openModal(id) {
    const el = $id(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('open');
    el.style.display = 'grid';
    el.querySelector('.modal-content')?.focus();
  }
  function closeModal(id) {
    const el = $id(id);
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
  }
  window.openModal  = openModal;
  window.closeModal = closeModal;

  // ===== 認証状態 =====
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
    const adminSec    = $id('adminSection'); // あれば
    const userPill    = $id('navUser');
    const profileLink = $id('profileLink');  // ← ここが今回の主役

    // ボタン類
    if (loggedIn) {
      if (loginBtn)    loginBtn.style.display    = 'none';
      if (registerBtn) registerBtn.style.display = 'none';
      if (logoutBtn)   logoutBtn.style.display   = 'inline-block';
      if (adminSec)    adminSec.style.display    = (user.role === 'admin') ? 'block' : 'none';
      if (userPill) {
        userPill.textContent = `👤 ${user.username || 'user'}`;
        userPill.hidden = false;
        userPill.style.display = 'inline-flex';
      }
    } else {
      if (loginBtn)    loginBtn.style.display    = 'inline-block';
      if (registerBtn) registerBtn.style.display = 'inline-block';
      if (logoutBtn)   logoutBtn.style.display   = 'none';
      if (adminSec)    adminSec.style.display    = 'none';
      if (userPill) {
        userPill.textContent = '';
        userPill.hidden = true;
        userPill.style.display = 'none';
      }
    }

    // ▼ プロフィールリンクの表示制御（ホーム限定＋ログイン時のみ）
    //   index.html でしか <a id="profileLink"> は無いので、他ページでは何もしない
    if (profileLink) {
      const isHome =
        location.pathname.endsWith('/index.html') ||
        location.pathname === '/' ||
        location.pathname === '' // ルート配信のケース
      ;
      // ログインしていて、かつホームにいる時だけ見せる
      profileLink.hidden = !(loggedIn && isHome);
      // スタイルで display:none にしている場合の保険
      if (!profileLink.hidden) profileLink.style.display = '';
    }
  }
  window.updateAuthUI = updateAuthUI;

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateAuthUI();
    alert('ログアウトしました');
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

  // ===== 商品表示（必要なページだけで動く） =====
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

  // ===== カート（教材用：メモリのみ） =====
  let cart = [];
  function addToCart(productId) {
    const found = cart.find(i => i.productId === productId);
    if (found) found.quantity += 1;
    else cart.push({ productId, quantity: 1 });
    alert('カートに追加しました');
  }
  window.addToCart = addToCart;

  // ===== 起動 =====
  document.addEventListener('DOMContentLoaded', () => {
    // モーダル
    $id('loginBtn')?.addEventListener('click', () => openModal('loginModal'));
    $id('registerBtn')?.addEventListener('click', () => openModal('registerModal'));
    $id('logoutBtn')?.addEventListener('click', logout);
    $id('loginClose')?.addEventListener('click', () => closeModal('loginModal'));
    $id('registerClose')?.addEventListener('click', () => closeModal('registerModal'));

    // 背景クリックで閉じる
    window.addEventListener('click', (e) => {
      if (e.target.classList?.contains('modal')) closeModal(e.target.id);
    });

    // 検索
    $id('searchBtn')?.addEventListener('click', () => {
      const term = $id('searchInput')?.value || '';
      loadProducts(term);
    });
    $id('searchInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loadProducts(e.currentTarget.value || '');
    });

    // 初期UI
    updateAuthUI();
    loadProducts();
  });
})();
