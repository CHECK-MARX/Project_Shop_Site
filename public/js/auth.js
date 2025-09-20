// public/js/auth.js
(() => {
  const $ = (s) => document.querySelector(s);

  // --- 互換: もし昔の偽トークンが残っていたら破棄 ---
  try {
    if (localStorage.getItem('token') === 'root-admin-token') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  } catch {}

  // ---- 新規登録 ----
  $('#registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#regUsername')?.value?.trim();
    const email    = $('#regEmail')?.value?.trim() || '';
    const password = $('#regPassword')?.value || '';
    if (!username || !password) return alert('ユーザー名とパスワードを入力してください');

    try {
      const r = await fetch('/api/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, email, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '登録に失敗しました');
      alert(`登録OK: userId=${data.userId}`);
      window.closeModal?.('registerModal');
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    }
  });

  // ---- ログイン（必ずサーバに投げて本物のJWTを取得）----
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername')?.value?.trim();
    const password = $('#loginPassword')?.value || '';
    if (!username || !password) return alert('ユーザー名とパスワードを入力してください');

    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'ログインに失敗しました');

      // 本物のトークンを保存
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      alert(`ログインOK: ${data.user?.username || username}`);
      window.closeModal?.('loginModal');
      if (typeof window.updateAuthUI === 'function') window.updateAuthUI();

      // 管理者なら admin.html に遷移（root/root もサーバ側で admin 扱い）
      if (data.user?.role === 'admin') {
        location.href = './admin.html';
      }
    } catch (err) {
      console.error(err);
      alert('ログインエラー: ' + err.message);
    }
  });

  console.log('auth.js loaded');
})();
