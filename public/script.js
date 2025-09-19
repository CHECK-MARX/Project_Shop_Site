/**********************
 * Modal helpers + Boot
 * （このブロックを既存のモーダル/初期化部分と置き換え）
 **********************/
const $id = id => document.getElementById(id);

// 共通: 表示
function openModal(id) {
  const el = $id(id);
  if (!el) return;
  el.classList.add('open');            // 任意（スタイルがあれば利用）
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  el.style.display = 'flex';           // auth.js と同じ見せ方に統一
  // フォーカス（アクセシビリティ改善 & スクロール抑止に寄与）
  el.querySelector('.modal-content')?.focus();
}

// 共通: 非表示
function closeModal(id) {
  const el = $id(id);
  if (!el) return;
  el.classList.remove('open');
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  // ARIAの警告抑制: モーダル内に残ったフォーカスを外へ逃がす
  document.activeElement?.blur?.();
}

// どの状態で来ても「モーダルは閉じた状態」から始める
function ensureAllModalsClosed() {
  closeModal('loginModal');
  closeModal('registerModal');
}

// 外側クリックで閉じる（中身クリックは閉じない）
function bindBackdropClose() {
  // モーダル外側（背景）クリック
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
  // モーダル内クリックはバブリング停止
  document.querySelectorAll('.modal-content').forEach(inner => {
    inner.addEventListener('click', (e) => e.stopPropagation());
  });
}

// ESCキーでアクティブなモーダルを閉じる
function bindEscToClose() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal:not(.hidden)');
    if (open) closeModal(open.id);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // リロード時に出ちゃうケースの対策
  ensureAllModalsClosed();

  // 開く
  $id('loginBtn')?.addEventListener('click', () => openModal('loginModal'));
  $id('registerBtn')?.addEventListener('click', () => openModal('registerModal'));

  // 閉じる（×ボタン）
  $id('loginClose')?.addEventListener('click', () => closeModal('loginModal'));
  $id('registerClose')?.addEventListener('click', () => closeModal('registerModal'));

  // ログアウトは既存関数を利用
  $id('logoutBtn')?.addEventListener('click', logout);

  // 背景クリック/ESCで閉じる
  bindBackdropClose();
  bindEscToClose();

  // 既存の初期処理
  loadUserData();
  loadProducts();

  // --- 既存ハンドラ（存在チェック付き） ---
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

// 公開（他ファイルやHTMLから呼べるように）
window.openModal      = openModal;
window.closeModal     = closeModal;
window.addToCart      = addToCart;
window.removeFromCart = removeFromCart;
window.logout         = logout;
