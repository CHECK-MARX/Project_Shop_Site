// public/js/auth.js
(() => {
  // ------- helpers -------
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const setBusy = (el, busy) => {
    if (!el) return;
    el.disabled = !!busy;
    el.dataset.busy = busy ? '1' : '';
  };

  const saveSession = (token, user) => {
    if (token) localStorage.setItem('token', token);
    if (user)  localStorage.setItem('user', JSON.stringify(user));
  };

  const clearSession = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  // ------- 登録 -------
  $('#registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#registerSubmit');

    const username = $('#regUsername')?.value?.trim();
    const email    = $('#regEmail')?.value?.trim() || '';
    const password = $('#regPassword')?.value || '';

    if (!username || !password) {
      alert('ユーザー名とパスワードを入力してください');
      return;
    }

    try {
      setBusy(btn, true);
      const r = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || '登録に失敗しました');

      alert(`登録OK: userId=${data.userId}`);
      // 入力を消してモーダルを閉じる
      $('#registerForm')?.reset();
      window.closeModal?.('registerModal');
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  // ------- ログイン -------
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginSubmit');

    const username = $('#loginUsername')?.value?.trim();
    const password = $('#loginPassword')?.value || '';

    if (!username || !password) {
      alert('ユーザー名とパスワードを入力してください');
      return;
    }

    try {
      setBusy(btn, true);
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'ログインに失敗しました');

      // セッション保存（token と user の両方）
      saveSession(data.token, data.user || { username });

      alert(`ログインOK: ${data.user?.username || username}`);

      // 入力を消してモーダルを閉じる
      $('#loginForm')?.reset();
      window.closeModal?.('loginModal');

      // ナビにユーザー名を反映
      if (typeof window.updateAuthUI === 'function') window.updateAuthUI();
    } catch (err) {
      console.error(err);
      alert('ログインエラー: ' + err.message);
      // 念のため破棄
      clearSession();
    } finally {
      setBusy(btn, false);
    }
  });

  console.log('auth.js loaded');
})();
