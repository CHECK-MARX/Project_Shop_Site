/* script.js - secure UI helpers for products/cart/navigation */
(() => {
  'use strict';
  if (window.__APP_CORE_LOADED__) return;
  window.__APP_CORE_LOADED__ = true;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = (n) => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`;
  window.$ = window.$ || $;
  window.$$ = window.$$ || $$;
  window.fmtJPY = window.fmtJPY || fmtJPY;

  const text = (value) => String(value ?? '');

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function appendAlert(container, cssClass, message) {
    if (!container) return;
    clear(container);
    const el = document.createElement('div');
    el.className = cssClass;
    el.style.gridColumn = '1/-1';
    el.style.textAlign = 'center';
    el.textContent = message;
    container.appendChild(el);
  }

  function safeImageSrc(rawSrc, fallbackSrc) {
    const src = text(rawSrc).trim();
    if (!src) return fallbackSrc;
    if (src.startsWith('/') || src.startsWith('./')) return src;
    try {
      const u = new URL(src, window.location.origin);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (_) {}
    return fallbackSrc;
  }

  // ==== Auth bridge ====
  const FallbackAuth = {
    getToken() { return ''; },
    getUser() { return null; },
    isLoggedIn() { return false; },
    openLogin() {
      const modal = $('#loginModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('open');
      document.body.classList.add('modal-open');
    }
  };

  const Auth = window.Auth ?? FallbackAuth;
  window.Auth = Auth;

  // ==== fetch helpers ====
  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function apiGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  window.fetchJSON = window.fetchJSON || fetchJSON;
  window.apiAuthGet = window.apiAuthGet || fetchJSON;

  // ==== in-memory cart (no Web Storage persistence) ====
  const cartByScope = new Map();
  const CART_SCOPE = 'active';

  function getCart() {
    const list = cartByScope.get(CART_SCOPE);
    return Array.isArray(list) ? list.map((x) => ({ ...x })) : [];
  }

  function setCart(list) {
    cartByScope.set(CART_SCOPE, Array.isArray(list) ? list.map((x) => ({ ...x })) : []);
    updateCartBadge();
    renderCartPage();
    window.dispatchEvent(new CustomEvent('cart:changed'));
  }

  function cartQtyOf(productId) {
    return getCart().reduce((sum, item) => sum + (item.productId === productId ? (Number(item.qty) || 0) : 0), 0);
  }

  function canAddOne(product) {
    const stock = Number(product.stock || 0);
    if (!Number.isFinite(stock) || stock <= 0) return false;
    return cartQtyOf(product.id) < stock;
  }

  window.AppCart = { get: getCart, set: setCart };

  function updateCartBadge() {
    const badge = $('#cartCount');
    if (!badge) return;
    const qty = getCart().reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    if (qty > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = String(qty);
    } else {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  }

  // ==== Auth UI ====
  function updateAuthUI() {
    const isIn = !!Auth.isLoggedIn?.();
    const user = Auth.getUser?.() || null;

    const login = $('#loginBtn');
    const reg = $('#registerBtn');
    const logout = $('#logoutBtn');
    const profile = $('#profileLink');
    const userPill = $('#navUser');

    if (login) login.style.display = isIn ? 'none' : '';
    if (reg) reg.style.display = isIn ? 'none' : '';
    if (logout) logout.style.display = isIn ? '' : 'none';
    if (profile) profile.style.display = isIn ? '' : 'none';

    if (userPill) {
      const uname = text(user?.username).trim();
      if (isIn && uname) {
        userPill.textContent = uname;
        userPill.hidden = false;
      } else {
        userPill.textContent = '';
        userPill.hidden = true;
      }
    }
  }

  // ==== products grid ====
  function buildProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';

    const pid = Number(product.id || 0);
    const stock = Number(product.stock || 0);
    const price = Math.round(Number(product.price || 0));
    const name = text(product.name || 'Product');
    const description = text(product.description || '');

    card.dataset.id = String(pid);
    card.dataset.name = name;
    card.dataset.price = String(price);
    card.dataset.stock = String(stock);

    const image = document.createElement('img');
    image.className = 'product-img';
    image.src = safeImageSrc(product.image_path, `https://picsum.photos/seed/p${pid}/800/500`);
    image.alt = name;

    const title = document.createElement('h3');
    title.textContent = name;

    const desc = document.createElement('p');
    desc.textContent = description;

    const priceEl = document.createElement('div');
    priceEl.className = 'product-price';
    priceEl.textContent = fmtJPY(price);

    const stockEl = document.createElement('div');
    stockEl.className = 'product-stock';
    stockEl.textContent = `在庫: ${stock}個`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary add-to-cart';
    addBtn.type = 'button';
    addBtn.textContent = 'カートに追加';

    card.appendChild(image);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(priceEl);
    card.appendChild(stockEl);
    card.appendChild(addBtn);
    return card;
  }

  function updateProductButtons(grid) {
    $$('.product-card', grid).forEach((card) => {
      const pid = Number(card.dataset.id);
      const stock = Number(card.dataset.stock || 0);
      const btn = $('.add-to-cart', card);
      if (!btn) return;
      if (stock <= 0) {
        btn.disabled = true;
        btn.textContent = '在庫なし';
        return;
      }
      if (cartQtyOf(pid) >= stock) {
        btn.disabled = true;
        btn.textContent = '在庫上限';
        return;
      }
      btn.disabled = false;
      btn.textContent = 'カートに追加';
    });
  }

  async function loadProducts(search = '') {
    const grid = $('#productsGrid');
    if (!grid) return;

    try {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      const items = await apiGet(`/api/products${qs}`);

      if (!Array.isArray(items) || items.length === 0) {
        appendAlert(grid, 'alert alert-info', '商品が見つかりませんでした');
        return;
      }

      clear(grid);
      for (const product of items) {
        grid.appendChild(buildProductCard(product));
      }

      updateProductButtons(grid);

      $$('.add-to-cart', grid).forEach((btn) => {
        btn.addEventListener('click', (event) => {
          const card = event.currentTarget.closest('.product-card');
          if (!card) return;

          const product = {
            id: Number(card.dataset.id),
            name: text(card.dataset.name),
            price: Number(card.dataset.price || 0),
            stock: Number(card.dataset.stock || 0)
          };

          if (!Auth.isLoggedIn?.()) {
            toast('ログインするとカートに追加できます');
            Auth.openLogin?.();
            return;
          }

          if (!canAddOne(product)) {
            event.currentTarget.disabled = true;
            event.currentTarget.textContent = product.stock <= 0 ? '在庫なし' : '在庫上限';
            toast('在庫数を超えています');
            return;
          }

          const list = getCart();
          const idx = list.findIndex((x) => x.productId === product.id);
          if (idx >= 0) {
            list[idx].qty = Math.min(product.stock, (list[idx].qty || 0) + 1);
          } else {
            list.push({
              productId: product.id,
              name: product.name,
              price: product.price,
              qty: 1
            });
          }

          setCart(list);
          toast('カートに追加しました');
          updateProductButtons(grid);
        });
      });
    } catch (_) {
      appendAlert(grid, 'alert alert-danger', '商品を読み込めませんでした');
    }
  }
  window.loadProducts = window.loadProducts || loadProducts;

  // ==== cart page ====
  function cartContainer() {
    return $('#cartItems') || $('#items') || null;
  }

  function buildCartItem(item) {
    const row = document.createElement('div');
    row.className = 'cart-item';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = text(item.name || '商品');

    const unit = document.createElement('div');
    unit.className = 'unit';
    unit.textContent = `単価: ${fmtJPY(item.price)}`;
    left.appendChild(title);
    left.appendChild(unit);

    const qtyWrap = document.createElement('div');
    qtyWrap.className = 'qty-wrap';

    const minus = document.createElement('button');
    minus.className = 'qty-btn minus';
    minus.dataset.id = String(item.productId);
    minus.type = 'button';
    minus.textContent = '−';

    const qty = document.createElement('span');
    qty.className = 'qty-pill';
    qty.textContent = String(item.qty);

    const plus = document.createElement('button');
    plus.className = 'qty-btn plus';
    plus.dataset.id = String(item.productId);
    plus.type = 'button';
    plus.textContent = '+';

    qtyWrap.appendChild(minus);
    qtyWrap.appendChild(qty);
    qtyWrap.appendChild(plus);

    const price = document.createElement('div');
    price.className = 'product-price';
    price.textContent = fmtJPY((Number(item.price) || 0) * (Number(item.qty) || 0));

    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.dataset.del = String(item.productId);
    del.type = 'button';
    del.textContent = '削除';

    row.appendChild(left);
    row.appendChild(qtyWrap);
    row.appendChild(price);
    row.appendChild(del);
    return row;
  }

  function renderCartPage() {
    const wrap = cartContainer();
    const totalEl = $('#cartTotal') || $('#total');
    if (!wrap && !totalEl) return;

    const list = getCart();
    const total = list.reduce((sum, item) => sum + (Math.round(Number(item.price) || 0) * (Number(item.qty) || 0)), 0);

    if (wrap) {
      clear(wrap);
      if (list.length === 0) {
        const info = document.createElement('div');
        info.className = 'alert alert-info';
        info.textContent = 'カートは空です';
        wrap.appendChild(info);
      } else {
        for (const item of list) {
          wrap.appendChild(buildCartItem(item));
        }
      }

      $$('.qty-btn.minus', wrap).forEach((btn) => {
        btn.addEventListener('click', (event) => {
          const id = Number(event.currentTarget.dataset.id);
          const next = getCart();
          const it = next.find((x) => x.productId === id);
          if (!it) return;
          it.qty = Math.max(1, (it.qty || 1) - 1);
          setCart(next);
        });
      });

      $$('.qty-btn.plus', wrap).forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          const id = Number(event.currentTarget.dataset.id);
          const next = getCart();
          const it = next.find((x) => x.productId === id);
          if (!it) return;

          try {
            const product = await apiGet(`/api/product/${id}`);
            const stock = Number(product.stock || 0);
            const cur = Number(it.qty || 1);
            if (cur >= stock) {
              toast('在庫数を超えています');
              return;
            }
            it.qty = cur + 1;
          } catch (_) {
            it.qty = Math.min(999, (it.qty || 1) + 1);
          }

          setCart(next);
        });
      });

      $$('[data-del]', wrap).forEach((btn) => {
        btn.addEventListener('click', (event) => {
          const id = Number(event.currentTarget.getAttribute('data-del'));
          const next = getCart().filter((x) => x.productId !== id);
          setCart(next);
        });
      });
    }

    if (totalEl) totalEl.textContent = fmtJPY(total);
  }

  function wireSearch() {
    const input = $('#searchInput');
    const btn = $('#searchBtn');
    if (!input || !btn) return;

    const exec = () => {
      const q = text(input.value).trim();
      if ($('#productsGrid')) {
        loadProducts(q);
      } else {
        location.href = `./products.html?q=${encodeURIComponent(q)}`;
      }
    };

    btn.addEventListener('click', exec);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') exec();
    });
  }

  function toast(msg) {
    let root = $('#toaster');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toaster';
      document.body.appendChild(root);
    }
    const note = document.createElement('div');
    note.textContent = text(msg);
    root.appendChild(note);
    setTimeout(() => note.remove(), 1500);
  }

  window.toast = window.toast || toast;
  window.updateCartBadge = window.updateCartBadge || updateCartBadge;

  // ==== admin links on nav ====
  async function fetchMe() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) return null;
      const body = await res.json();
      return body?.user || null;
    } catch (_) {
      return null;
    }
  }

  function renderAdminLinks(isAdmin) {
    const nav = $('.nav-links');
    if (!nav) return;

    $('#navInventory')?.remove();
    $('#navAdmin')?.remove();
    if (!isAdmin) return;

    const currentPath = (location.pathname || '').toLowerCase();
    const makeLink = (id, href, label) => {
      const link = document.createElement('a');
      link.id = id;
      link.href = href;
      link.textContent = label;
      if (currentPath.endsWith(href.replace('./', '/'))) {
        link.setAttribute('aria-current', 'page');
        link.style.fontWeight = '700';
      }
      return link;
    };

    const adminLink = makeLink('navAdmin', './admin.html', '管理画面');
    const invLink = makeLink('navInventory', './inventory.html', '在庫管理');

    const authButtons = $('.auth-buttons');
    const parent = authButtons?.parentElement;
    const insert = (el) => {
      try {
        if (authButtons && parent) parent.insertBefore(el, authButtons);
        else nav.appendChild(el);
      } catch (_) {
        nav.appendChild(el);
      }
    };

    insert(adminLink);
    insert(invLink);
  }

  async function updateAdminNav() {
    try {
      const me = await fetchMe();
      renderAdminLinks(!!me && me.role === 'admin');
    } catch (_) {}
  }
  window.updateAdminNav = window.updateAdminNav || updateAdminNav;

  // ==== bestseller ====
  async function loadBestsellers(limit = 10) {
    const wrap = $('#bestWrap');
    const box = $('#bestList');
    if (!wrap || !box) return;

    clear(box);

    async function fetchPublic() {
      const res = await fetch(`/api/bestsellers?limit=${encodeURIComponent(limit)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    async function fetchAdminFallback() {
      const sales = await fetchJSON('/api/admin/sales-summary');
      const products = await fetch('/api/products', { credentials: 'include' }).then((r) => r.ok ? r.json() : []);
      const pmap = new Map((Array.isArray(products) ? products : []).map((p) => [Number(p.id), p]));
      return (Array.isArray(sales) ? sales : [])
        .map((s) => {
          const p = pmap.get(Number(s.product_id));
          return p ? { ...p, sold: Number(s.sold) || 0 } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b.sold || 0) - (a.sold || 0))
        .slice(0, limit);
    }

    try {
      let data = [];
      try {
        data = await fetchPublic();
      } catch (_) {
        data = await fetchAdminFallback();
      }

      if (!Array.isArray(data) || data.length === 0) {
        wrap.style.display = 'none';
        return;
      }

      data.forEach((p, i) => {
        const pid = Number(p.id || 0);
        const sold = Number(p.sold || 0).toLocaleString('ja-JP');
        const stock = Number(p.stock || 0);
        const name = text(p.name || 'Product');

        const card = document.createElement('a');
        card.className = 'best-card';
        card.href = `./products.html?q=${encodeURIComponent(name)}`;
        card.style.position = 'relative';

        const rank = document.createElement('span');
        rank.className = 'best-rank';
        rank.textContent = String(i + 1);

        const img = document.createElement('img');
        img.src = safeImageSrc(p.image_path, `https://picsum.photos/seed/p${pid}/600/380`);
        img.alt = name;

        const title = document.createElement('div');
        title.className = 'best-name';
        title.textContent = name;

        const meta = document.createElement('div');
        meta.className = 'best-meta';
        meta.textContent = `売れた: ${sold} / 在庫: ${stock}`;

        card.appendChild(rank);
        card.appendChild(img);
        card.appendChild(title);
        card.appendChild(meta);
        box.appendChild(card);
      });

      wrap.style.display = '';
    } catch (_) {
      wrap.style.display = 'none';
    }
  }
  window.loadBestsellers = window.loadBestsellers || loadBestsellers;

  // ==== recent orders ====
  function buildOrderCard(order) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.style.display = 'grid';
    card.style.gridTemplateColumns = '1fr auto';
    card.style.gap = '8px';

    const left = document.createElement('div');

    const idRow = document.createElement('div');
    idRow.style.fontWeight = '700';
    idRow.textContent = `注文ID: ${text(order.orderId || '')}`;

    const dt = new Date(order.created_at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const when = `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

    const timeRow = document.createElement('div');
    timeRow.style.opacity = '.85';
    timeRow.textContent = when;

    const amountRow = document.createElement('div');
    amountRow.style.marginTop = '4px';
    amountRow.textContent = `合計 ${fmtJPY(order.total)} (小計 ${fmtJPY(order.subtotal)} / 税 ${fmtJPY(order.tax)})`;

    const cardRow = document.createElement('div');
    cardRow.style.opacity = '.8';
    cardRow.textContent = `カード **** ${text(order.last4 || '****')}`;

    left.appendChild(idRow);
    left.appendChild(timeRow);
    left.appendChild(amountRow);
    left.appendChild(cardRow);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';

    const detail = document.createElement('a');
    detail.className = 'btn btn-secondary';
    detail.href = `./order-complete.html?ref=${encodeURIComponent(text(order.orderId || ''))}`;
    detail.textContent = '詳細';

    right.appendChild(detail);
    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  async function loadRecentOrders() {
    const box = $('#recentOrders');
    const hint = $('#ordersHint');
    if (!box) return;

    if (!Auth.isLoggedIn?.()) {
      appendAlert(box, 'alert alert-info', 'ログインすると最近の注文が表示されます。');
      if (hint) hint.textContent = '';
      return;
    }

    try {
      const rows = await fetchJSON('/api/my-orders?limit=5');
      if (!Array.isArray(rows) || rows.length === 0) {
        appendAlert(box, 'alert alert-info', 'まだ注文がありません。');
        if (hint) hint.textContent = '';
        return;
      }

      clear(box);
      rows.forEach((order) => box.appendChild(buildOrderCard(order)));
      if (hint) hint.textContent = '直近5件まで表示しています。';
    } catch (_) {
      appendAlert(box, 'alert alert-danger', '注文履歴を取得できませんでした。');
      if (hint) hint.textContent = '';
    }
  }

  // ==== init ====
  document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();
    updateCartBadge();

    const q = new URLSearchParams(location.search).get('q') || '';
    if ($('#productsGrid')) loadProducts(q);
    if (cartContainer() || $('#cartTotal') || $('#total')) renderCartPage();

    wireSearch();
    updateAdminNav();
    loadRecentOrders();
    loadBestsellers(10);

    $('#logoutBtn')?.addEventListener('click', () => {
      fetch('/api/logout', { method: 'POST', credentials: 'include' }).finally(() => {
        updateAuthUI();
        location.href = './index.html';
      });
    });
  });

  window.addEventListener('auth:changed', () => {
    updateAuthUI();
    updateAdminNav();
  });

  window.addEventListener('cart:changed', () => {
    updateCartBadge();
    renderCartPage();
    if ($('#productsGrid')) {
      const q = new URLSearchParams(location.search).get('q') || '';
      loadProducts(q);
    }
  });

  window.addEventListener('focus', () => updateAdminNav());
})();
