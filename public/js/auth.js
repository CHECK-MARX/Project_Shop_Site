// public/js/auth.js
(() => {
  const $ = (s) => document.querySelector(s);

  // ---- 登録: サーバ登録 + デモ用ローカルキャッシュにも控えを保存 ----
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
      // ★ デモ用ローカルキャッシュにも保存
      try {
        const key='__demo_users__';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.push({
          id: data.userId ?? (arr.length+1),
          username, email, password,
          role: 'user'
        });
        localStorage.setItem(key, JSON.stringify(arr));
      } catch {}

      window.closeModal?.('registerModal');
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    }
  });

  // ---- ログイン ----
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername')?.value?.trim();
    const password = $('#loginPassword')?.value || '';
    if (!username || !password) return alert('ユーザー名とパスワードを入力してください');

    // ★ 教材用ショートカット（root/root）
    if (username === 'root' && password === 'root') {
      const fakeToken = 'root-admin-token';
      const user = { id: 0, username: 'root', role: 'admin', email: 'root@local' };
      localStorage.setItem('token', fakeToken);
      localStorage.setItem('user', JSON.stringify(user));
      alert('管理者としてログインしました（デモ）');
      window.closeModal?.('loginModal');
      if (typeof window.updateAuthUI === 'function') window.updateAuthUI();
      location.href = './admin.html';
      return;
    }

    // 通常ログイン
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'ログインに失敗しました');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      alert(`ログインOK: ${data.user?.username || username}`);
      window.closeModal?.('loginModal');
      if (typeof window.updateAuthUI === 'function') window.updateAuthUI();
    } catch (err) {
      console.error(err);
      alert('ログインエラー: ' + err.message);
    }
  });

  console.log('auth.js loaded');
})();
