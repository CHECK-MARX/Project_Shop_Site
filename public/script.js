// public/script.js

// ===== ユーティリティ =====
const $id = (id) => document.getElementById(id);

// ===== モーダル制御 =====
function openModal(id) {
  const el = $id(id);
  if (!el) return;
  el.classList.add('open');
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  el.querySelector('.modal-content')?.focus();
}
function closeModal(id) {
  const el = $id(id);
  if (!el) return;
  el.classList.remove('open');
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
}

// ===== 簡易ユーザ状態 =====
let currentUser = null;
let authToken   = null;
let cart = [];

function updateAuthUI() {
  const loginBtn    = $id('loginBtn');
  const registerBtn = $id('registerBtn');
  const logoutBtn   = $id('logoutBtn');
  const adminSec    = $id('adminSection');

  const isAuthed = !!localStorage.getItem('token');

  if (isAuthed) {
    if (loginBtn)    loginBtn.style.display    = 'none';
    if (registerBtn) registerBtn.style.display = 'none';
    if (logoutBtn)   logoutBtn.style.display   = 'inline-block';
    if (adminSec)    adminSec.style.display    = 'block'; // 教材用
  } else {
    if (loginBtn)    loginBtn.style.display    = 'inline-block';
    if (registerBtn) registerBtn.style.display = 'inline-block';
    if (logoutBtn)   logoutBtn.style.display   = 'none';
    if (adminSec)    adminSec.style.display    = 'none';
  }
}

function logout() {
  localStorage.removeItem('token');
  currentUser = null;
  authToken   = null;
  cart = [];
  updateAuthUI();
  alert('ログアウトしました');
}

// ===== API 共通 =====
async function makeAPICall(url, options = {}) {
  const token = localStorage.getItem('token');
  const r = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status}`);
  return data;
}

// ===== 商品カード（安全版） =====
// ★ textContent でノードを組み立て、XSS を防ぐ
function createProductCardSafe(p) {
  const card  = document.createElement('div');
  card.className = 'product-card';

  const h3 = document.createElement('h3');
  h3.textContent = p.name;

  const desc = document.createElement('p');
  desc.textContent = p.description; // ここを innerHTML にしない！

  const price = document.createElement('div');
  price.className = 'product-price';
  price.textContent = `¥${p.price}`;

  const stock = document.createElement('div');
  stock.className = 'product-stock';
  stock.textContent = `在庫: ${p.stock}個`;

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = 'カートに追加';
  btn.addEventListener('click', () => addToCart(p.id));

  card.append(h3, desc, price, stock, btn);
  return card;
}

// ===== 商品ロード & 表示 =====
async function loadProducts(search = '') {
  try {
    const url = search ? `/api/products?search=${encodeURIComponent(search)}` : '/api/products';
    const products = await makeAPICall(url);
    const grid = $id('productsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    products.forEach(p => {
      const card = createProductCardSafe(p);  // ← 安全版カードを使用
      grid.appendChild(card);
    });
  } catch (e) {
    console.error(e);
    alert('商品取得に失敗しました');
  }
}

// ===== カート =====
function addToCart(productId) {
  const found = cart.find(i => i.productId === productId);
  if (found) found.quantity += 1;
  else cart.push({ productId, quantity: 1 });
  alert('カートに追加しました');
}

// ===== 起動処理 =====
document.addEventListener('DOMContentLoaded', () => {
  // モーダルは必ず閉じて始める（リロードで出っぱなし防止）
  closeModal('loginModal');
  closeModal('registerModal');

  // ボタン → モーダル開閉
  $id('loginBtn')?.addEventListener('click', () => openModal('loginModal'));
  $id('registerBtn')?.addEventListener('click', () => openModal('registerModal'));
  $id('logoutBtn')?.addEventListener('click', logout);
  $id('loginClose')?.addEventListener('click', () => closeModal('loginModal'));
  $id('registerClose')?.addEventListener('click', () => closeModal('registerModal'));

  // 背景クリックで閉じる
  window.addEventListener('click', (e) => {
    if (e.target.classList?.contains('modal')) closeModal(e.target.id);
  });

  // # アンカーでスムーススクロール（ホーム / 商品 / カート）
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.getAttribute('href').slice(1);
      const el = $id(id);
      el?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // 検索
  $id('searchBtn')?.addEventListener('click', () => {
    const term = $id('searchInput')?.value || '';
    loadProducts(term);
  });
  $id('searchInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const term = e.currentTarget.value || '';
      loadProducts(term);
    }
  });

  updateAuthUI();
  loadProducts();
});

// ===== グローバル公開（HTMLのonclick対策） =====
window.openModal      = openModal;
window.closeModal     = closeModal;
window.logout         = logout;
window.addToCart      = addToCart;
window.loadProducts   = loadProducts;
window.updateAuthUI   = updateAuthUI;
