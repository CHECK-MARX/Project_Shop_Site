// public/script.js ーーー 検索の挙動を強化（ホーム→商品一覧へ遷移 / 未ヒット時はホームに丁寧表示）
// 既存のモーダル、認証UI、商品描画、カート機能は維持

(() => {
  // ===== 基本ユーティリティ =====
  const $id = (id) => document.getElementById(id);
  const qs  = (sel) => document.querySelector(sel);

  // ===== モーダル制御（強制表示/非表示）=====
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
    const adminSec    = $id('adminSection');
    const userPill    = $id('navUser');

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
    }
  }
  window.updateAuthUI = updateAuthUI;

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    cart = [];
    saveCart();
    updateAuthUI();
    alert('ログアウトしました');
    renderCartPreview();
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

  // ===== カート（ページ間共有） =====
  const CART_KEY = 'cart';
  let cart = [];

  function loadCart() {
    try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch { cart = []; }
  }
  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    renderCartPreview();
  }

  // ===== 商品一覧の描画 =====
  async function loadProducts(search = '') {
    const grid = $id('productsGrid');
    if (!grid) return; // 該当ページでのみ実行
    try {
      const url = search
        ? `/api/products?search=${encodeURIComponent(search)}`
        : '/api/products';
      const products = await api(url);

      grid.innerHTML = '';

      if (!Array.isArray(products) || products.length === 0) {
        // 商品ページ側での「0件」表示
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:16px 0;color:#9fb0c8;';
        empty.textContent   = '該当する商品は見つかりませんでした。';
        grid.appendChild(empty);
        return;
      }

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

  // ===== カート操作 =====
  function addToCart(productId) {
    const found = cart.find(i => i.productId === productId);
    if (found) found.quantity += 1;
    else cart.push({ productId, quantity: 1 });
    saveCart();
    alert('カートに追加しました');
  }
  window.addToCart = addToCart;

  function removeFromCart(productId){
    cart = cart.filter(i => i.productId !== productId);
    saveCart();
  }
  window.removeFromCart = removeFromCart;

  // ===== ホーム用：カートの「合計」「プレビュー」を描画 =====
  async function renderCartPreview() {
    const itemsEl = $id('cartItems'); // あれば項目も
    const totalEl = $id('cartTotal');
    if (!itemsEl && !totalEl) return;

    if (itemsEl) itemsEl.innerHTML = '';
    if (totalEl) totalEl.textContent = '¥0';

    if (!cart || cart.length === 0) {
      if (itemsEl) itemsEl.innerHTML = '<p>カートは空です</p>';
      return;
    }

    let total = 0;

    for (const it of cart) {
      try {
        const p = await api(`/api/product/${it.productId}`);
        const t = p.price * it.quantity;
        total += t;

        if (itemsEl) {
          itemsEl.insertAdjacentHTML('beforeend', `
            <div class="cart-item">
              <div>
                <h4>${p.name}</h4>
                <p>数量: ${it.quantity}</p>
              </div>
              <div><span class="product-price">¥${t.toFixed(2)}</span></div>
            </div>
          `);
        }
      } catch (e) {
        console.error('プレビュー価格取得失敗', e);
      }
    }

    if (totalEl) totalEl.textContent = '¥' + total.toFixed(2);
  }
  window.renderCartPreview = renderCartPreview;

  // ===== 検索：ホーム→商品一覧 連携 =====
  // ・ヒット > 0 : products.html?search=... に遷移
  // ・ヒット = 0 : ホーム上で「在庫はございません」と表示（クリック/ESC/タイムアウトで消える）
  function showHomeMsg(text) {
    // 置き場所は検索ボックスのすぐ下
    const container = document.querySelector('.search-container') || $id('home') || document.body;

    // 既存メッセージがあれば再利用
    let msg = $id('homeSearchMsg');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'homeSearchMsg';
      msg.style.cssText = `
        margin-top:10px;color:#9fb0c8;transition:opacity .18s ease;opacity:0;
        background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
        padding:8px 12px;border-radius:8px;display:inline-block;
      `;
      container.appendChild(msg);
    }
    msg.textContent = text;
    // フェードイン
    requestAnimationFrame(() => { msg.style.opacity = '1'; });

    // ---- 消し方：外側クリック / Esc / タイムアウト ----
    const removeMsg = () => {
      if (!msg || msg.isRemoving) return;
      msg.isRemoving = true;
      msg.style.opacity = '0';
      setTimeout(() => msg?.remove(), 180);
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onDocClick = (ev) => {
      // 検索ボックスの内側を除外（そこで操作しても消さない）
      const inside = container.contains(ev.target);
      if (!inside) removeMsg();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') removeMsg();
    };

    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    // 5秒後に自動で消える（お好みで調整/削除可）
    clearTimeout(msg._hideTimer);
    msg._hideTimer = setTimeout(removeMsg, 5000);
  }

  async function handleHomeSearch(term) {
    const t = term.trim();
    if (!t) return;
    try {
      const results = await api(`/api/products?search=${encodeURIComponent(t)}`);
      if (Array.isArray(results) && results.length > 0) {
        // 商品ページへクエリ付きで遷移
        location.href = `products.html?search=${encodeURIComponent(t)}`;
      } else {
        showHomeMsg('検索された商品の在庫はございません。');
      }
    } catch (e) {
      console.error(e);
      showHomeMsg('検索中にエラーが発生しました。');
    }


    // 結果メッセージ表示欄（無ければ生成）
    let msg = $id('homeSearchMsg');
    if (!msg) {
      const cont = qs('.search-container') || $id('home') || document.body;
      msg = document.createElement('div');
      msg.id = 'homeSearchMsg';
      msg.style.cssText = 'margin-top:10px;color:#9fb0c8;';
      cont.appendChild(msg);
    }
    msg.textContent = '';

    try {
      const results = await api(`/api/products?search=${encodeURIComponent(t)}`);
      if (Array.isArray(results) && results.length > 0) {
        // 商品ページへクエリ付きで遷移
        location.href = `products.html?search=${encodeURIComponent(t)}`;
      } else {
        msg.textContent = '検索された商品の在庫はございません。';
        // 少しだけ視線誘導
        msg.animate?.([{opacity:0},{opacity:1}], {duration:200, fill:'forwards'});
      }
    } catch (e) {
      console.error(e);
      msg.textContent = '検索中にエラーが発生しました。';
    }
  }

  // ===== 起動処理 =====
  document.addEventListener('DOMContentLoaded', () => {
    closeModal('loginModal');
    closeModal('registerModal');

    // 先にカートを同期
    loadCart();

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

    // ===== 検索の結線 =====
    // ホームや商品ページ共通の検索ボタン/Enter
    const searchBtn   = $id('searchBtn');
    const searchInput = $id('searchInput');

    // products.html で URL クエリを読んで初回検索
    const params = new URLSearchParams(location.search);
    const initSearch = params.get('search') || '';
    if (searchInput && initSearch) searchInput.value = initSearch;

    // 検索ボタン
    searchBtn?.addEventListener('click', () => {
      const term = searchInput?.value || '';
      // products.html では画面内検索、home では件数判定→遷移/表示
      if ($id('productsGrid')) {
        loadProducts(term);
      } else {
        handleHomeSearch(term);
      }
    });

    // Enter でも発火
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const term = e.currentTarget.value || '';
        if ($id('productsGrid')) {
          loadProducts(term);
        } else {
          handleHomeSearch(term);
        }
      }
    });

    // 他タブのカート変更に追従
    window.addEventListener('storage', (ev) => {
      if (ev.key === CART_KEY) {
        loadCart();
        renderCartPreview();
      }
    });

    // 初期UIと初期描画
    updateAuthUI();

    // products.html なら URLの search を反映して描画
    if ($id('productsGrid')) {
      loadProducts(initSearch);
    }

    // ホームなどのプレビュー更新
    renderCartPreview();
  });
})();
