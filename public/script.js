// public/script.js
(() => {
    const $id = (id) => document.getElementById(id);
  
// ==== Modal control（強制版）====
function openModal(id){
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden','false');
    el.classList.add('open');
    el.style.display = 'grid';               // ← 強制で表示
    el.querySelector('.modal-content')?.focus();
  }
  
  function closeModal(id){
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.remove('open');
    el.classList.add('hidden');
    el.setAttribute('aria-hidden','true');
    el.style.display = 'none';               // ← 強制で非表示
  }
  
  // 公開（HTML からも呼べるように）
  window.openModal  = openModal;
  window.closeModal = closeModal;
  
  
    // ===== 状態とAPI（省略可：前のままでOK） =====
    let cart = [];
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
  
    function updateAuthUI() {
      const authed = !!localStorage.getItem('token');
      const show = (id, on) => { const el = $id(id); if (el) el.style.display = on ? 'inline-block' : 'none'; };
      show('loginBtn', !authed);
      show('registerBtn', !authed);
      show('logoutBtn', authed);
      const admin = $id('adminSection');
      if (admin) admin.style.display = authed ? 'block' : 'none';
    }
    window.updateAuthUI = updateAuthUI;
  
    function logout() {
      localStorage.removeItem('token');
      cart = [];
      updateAuthUI();
      alert('ログアウトしました');
    }
    window.logout = logout;
  
    async function loadProducts(search = '') {
      try {
        const url = search ? `/api/products?search=${encodeURIComponent(search)}` : '/api/products';
        const products = await api(url);
        const grid = $id('productsGrid');
        if (!grid) return;
        grid.innerHTML = '';
        for (const p of products) {
          const card = document.createElement('div'); card.className = 'product-card';
          const h3 = document.createElement('h3'); h3.textContent = p.name;
          const d  = document.createElement('p');  d.textContent  = p.description;
          const pr = document.createElement('div'); pr.className='product-price'; pr.textContent=`¥${p.price}`;
          const st = document.createElement('div'); st.className='product-stock'; st.textContent=`在庫: ${p.stock}個`;
          const btn= document.createElement('button'); btn.className='btn btn-primary'; btn.type='button'; btn.textContent='カートに追加';
          btn.addEventListener('click', () => addToCart(p.id));
          card.append(h3,d,pr,st,btn); grid.appendChild(card);
        }
      } catch (e) {
        console.error(e); alert('商品取得に失敗しました');
      }
    }
    window.loadProducts = loadProducts;
  
    function addToCart(productId) {
      const found = cart.find(i => i.productId === productId);
      if (found) found.quantity += 1; else cart.push({ productId, quantity: 1 });
      alert('カートに追加しました');
    }
    window.addToCart = addToCart;
  
    // ===== 起動 =====
    document.addEventListener('DOMContentLoaded', () => {
      // まずは全部閉じて開始（リロード時の出っぱなし対策）
      closeModal('loginModal');
      closeModal('registerModal');
      document.getElementById('loginBtn')?.addEventListener('click', () => openModal('loginModal'));
      document.getElementById('registerBtn')?.addEventListener('click', () => openModal('registerModal'));
      document.getElementById('logoutBtn')?.addEventListener('click', () => { localStorage.removeItem('token'); alert('ログアウトしました'); });      
      // ボタン → 開閉
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
  
      updateAuthUI();
      loadProducts();
    });
  })();
  