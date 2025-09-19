// public/js/auth.js
// ログイン / 新規登録の最小実装（文法エラー無し版）

(() => {
  const $ = (sel) => document.querySelector(sel);

  // モーダルを閉じるヘルパ（script.js の closeModal を使えるなら使う）
  const close = (id) => {
    if (typeof window.closeModal === 'function') {
      window.closeModal(id);
    } else {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('open');
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
      }
    }
  };

  // UI 更新（script.js の updateAuthUI があれば呼ぶ）
  const refreshUI = () => {
    if (typeof window.updateAuthUI === 'function') {
      window.updateAuthUI();
    }
  };

  // ========== 新規登録 ==========
  const regForm = $('#registerForm');
  regForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = $('#regUsername')?.value?.trim();
    const email    = $('#regEmail')?.value?.trim() || '';
    const password = $('#regPassword')?.value || '';

    if (!username || !password) {
      alert('ユーザー名とパスワードを入力してください');
      return;
    }

    try {
      const r = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '登録に失敗しました');

      alert(`登録OK: userId=${data.userId}`);
      close('registerModal');
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    }
  });

  // ========== ログイン ==========
  const loginForm = $('#loginForm');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = $('#loginUsername')?.value?.trim();
    const password = $('#loginPassword')?.value || '';

    if (!username || !password) {
      alert('ユーザー名とパスワードを入力してください');
      return;
    }

    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'ログインに失敗しました');

      // トークン保存 & UI 更新
      localStorage.setItem('token', data.token);
      alert(`ログインOK: ${data.user?.username || username}`);

      close('loginModal');
      refreshUI();
    } catch (err) {
      console.error(err);
      alert('ログインエラー: ' + err.message);
    }
  });

  // 読み込み済みの表示確認（デバッグ）
  console.log('auth.js loaded');
})();
