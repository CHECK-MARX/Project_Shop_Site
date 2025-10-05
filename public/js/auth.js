/* auth.js — 統一ログイン/登録/ログアウト + 管理者リダイレクト
   - ログイン状態は localStorage 'token' と 'auth_user' に統一
   - どこからでも Auth.* を呼べる（script.js からも利用）
*/
(function () {
  const LS_TOKEN = 'token';
  const LS_USER  = 'auth_user';

  // ===== ユーティリティ =====
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const Auth = {
    getToken() {
      // 互換: 以前のキー名に入っている場合も吸収
      const fallbacks = ['token','jwt','jwtToken','auth_token','authToken'];
      for (const k of [LS_TOKEN, ...fallbacks]) {
        const v = localStorage.getItem(k);
        if (v && v.length > 10) return v;
      }
      return '';
    },
    getUser() {
      try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch { return null; }
    },
    isLoggedIn() { return !!this.getToken(); },
    isAdmin() {
      const u = this.getUser();
      return !!(u && (u.role === 'admin'));
    },
    openLogin() {
      const m = $('#loginModal');
      if (m) { m.classList.remove('hidden'); m.classList.add('open'); document.body.classList.add('modal-open'); }
    },
    closeModals() {
      $$('.modal.open').forEach(m => { m.classList.remove('open'); m.classList.add('hidden'); });
      document.body.classList.remove('modal-open');
    },
    setSession(token, user) {
      localStorage.setItem(LS_TOKEN, token || '');
      localStorage.setItem(LS_USER, JSON.stringify(user||{}));
      // 互換で残っている他キーは掃除
      ['jwt','jwtToken','auth_token','authToken'].forEach(k => localStorage.removeItem(k));
      // ナビ表示
      const navUser  = $('#navUser');
      const logoutBtn= $('#logoutBtn');
      const loginBtn = $('#loginBtn');
      const regBtn   = $('#registerBtn');
      if (navUser)  { navUser.textContent = user?.username || ''; navUser.hidden = false; navUser.style.display='inline-block'; }
      if (logoutBtn) logoutBtn.style.display = 'inline-block';
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (regBtn)    regBtn.style.display    = 'none';
    },
    clearSession() {
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_USER);
      ['jwt','jwtToken','auth_token','authToken'].forEach(k => localStorage.removeItem(k));
      // ナビ表示
      const navUser  = $('#navUser');
      const logoutBtn= $('#logoutBtn');
      const loginBtn = $('#loginBtn');
      const regBtn   = $('#registerBtn');
      if (navUser)  { navUser.textContent = ''; navUser.hidden = true; navUser.style.display='none'; }
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (loginBtn)  loginBtn.style.display  = 'inline-block';
      if (regBtn)    regBtn.style.display    = 'inline-block';
    }
  };
  window.Auth = Auth; // 公開

  // ===== フォーム配線 =====
  document.addEventListener('DOMContentLoaded', () => {
    // 既ログイン表示
    if (Auth.isLoggedIn()) {
      const u = Auth.getUser();
      if (u) Auth.setSession(Auth.getToken(), u);
    }

    // モーダル閉じる
    $('#loginClose')    && $('#loginClose').addEventListener('click', Auth.closeModals);
    $('#registerClose') && $('#registerClose').addEventListener('click', Auth.closeModals);

    // 開くボタン
    $('#loginBtn')    && $('#loginBtn').addEventListener('click', Auth.openLogin);
    $('#registerBtn') && $('#registerBtn').addEventListener('click', () => {
      const m = $('#registerModal'); if (m) { m.classList.remove('hidden'); m.classList.add('open'); document.body.classList.add('modal-open'); }
    });

    // ログアウト
    $('#logoutBtn') && $('#logoutBtn').addEventListener('click', () => {
      Auth.clearSession();
      // ログアウト時も表示を更新
      const badge = $('#cartCount'); if (badge) { badge.style.display='none'; badge.textContent='0'; }
      // 管理者ページに居たらトップへ
      if (location.pathname.endsWith('/admin.html')) location.href = './index.html';
      else location.reload();
    });

    // ログイン送信
    const loginForm = $('#loginForm');
    if (loginForm) loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#loginUsername')?.value?.trim() || '';
      const password = $('#loginPassword')?.value || '';
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(data?.error || 'login failed');

        Auth.setSession(data.token, data.user);
        Auth.closeModals();

        // カート guest をマージ（保険）
        try {
          const guest = JSON.parse(localStorage.getItem('cart:guest') || '[]');
          if (guest.length) {
            const key = `cart:${data.user?.username || 'guest'}`;
            const cur = JSON.parse(localStorage.getItem(key) || '[]');
            guest.forEach(g => {
              const i = cur.findIndex(x => x.productId === g.productId);
              if (i >= 0) cur[i].qty = (cur[i].qty||0) + (g.qty||0);
              else cur.push(g);
            });
            localStorage.setItem(key, JSON.stringify(cur));
            localStorage.removeItem('cart:guest');
          }
        } catch {}

        // 管理者なら admin.html へ
        if (data.user?.role === 'admin' && !location.pathname.endsWith('/admin.html')) {
          location.href = './admin.html';
          return;
        }

        // 画面更新（バッジ/ナビ反映）
        location.reload();
      } catch (err) {
        console.error(err);
        window.toast?.('Invalid credentials');
        alert('ログインに失敗しました');
      }
    });

    // 新規登録
    const regForm = $('#registerForm');
    if (regForm) regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#regUsername')?.value?.trim() || '';
      const email    = $('#regEmail')?.value?.trim() || '';
      const password = $('#regPassword')?.value || '';
      try {
        const res = await fetch('/api/register', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ username, email, password })
        });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(data?.error || 'register failed');
        alert('登録しました。ログインしてください。');
        Auth.closeModals();
        Auth.openLogin();
      } catch (err) {
        console.error(err);
        alert('登録に失敗しました');
      }
    });
  });
})();
