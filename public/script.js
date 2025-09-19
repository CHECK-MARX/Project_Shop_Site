// ===== Modal helpers =====
const $id = id => document.getElementById(id);

function openModal(id) {
  const el = $id(id);
  if (!el) return;
  el.classList.add('open');               // 表示はクラスで制御
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  // 初回フォーカス（スクロール抑止にも効く）
  el.querySelector('.modal-content')?.focus();
}

function closeModal(id) {
  const el = $id(id);
  if (!el) return;
  el.classList.remove('open');
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
}

// ===== boot =====
document.addEventListener('DOMContentLoaded', () => {
  // どんな状態で来ても必ず閉じて始める（リロード時に出ちゃう対策）
  closeModal('loginModal');
  closeModal('registerModal');

  // ボタンは開閉だけ（submit は auth.js が担当）
  $id('loginBtn')?.addEventListener('click', () => openModal('loginModal'));
  $id('registerBtn')?.addEventListener('click', () => openModal('registerModal'));
  $id('logoutBtn')?.addEventListener('click', logout);

  $id('loginClose')?.addEventListener('click', () => closeModal('loginModal'));
  $id('registerClose')?.addEventListener('click', () => closeModal('registerModal'));

  // 背景クリックで閉じる
  window.addEventListener('click', (e) => {
    if (e.target.classList?.contains('modal')) closeModal(e.target.id);
  });

  // 既存の初期処理
  loadUserData();
  loadProducts();

  // --- 以下は既存と同じ（存在チェック済み） ---
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
  $id('checkoutBtn')?.addEventListener('click', checkout);
  $id('viewUsersBtn')?.addEventListener('click', viewUsers);
  $id('backupBtn')?.addEventListener('click', createBackup);
  $id('debugBtn')?.addEventListener('click', showDebugInfo);
  $id('sqlTestBtn')?.addEventListener('click', testSQLInjection);
  $id('xssTestBtn')?.addEventListener('click', testXSS);
  $id('pathTestBtn')?.addEventListener('click', testPathTraversal);
});

// 既存の公開
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.openModal = openModal;
window.closeModal = closeModal;
