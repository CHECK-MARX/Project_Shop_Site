/* auth.js - cookie-based authentication helpers */
(() => {
  'use strict';
  if (window.__AUTH_MODULE_LOADED__) return;
  window.__AUTH_MODULE_LOADED__ = true;

  let sessionUser = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const normalizeUser = (user) => {
    if (!user || !user.username) return null;
    return {
      id: user.id,
      username: String(user.username),
      email: user.email ? String(user.email) : '',
      role: user.role ? String(user.role) : 'user'
    };
  };

  const updateNav = (user) => {
    const navUser = $('#navUser');
    const logoutBtn = $('#logoutBtn');
    const loginBtn = $('#loginBtn');
    const regBtn = $('#registerBtn');
    const profileLink = $('#profileLink');

    const loggedIn = !!(user && user.username);

    if (navUser) {
      navUser.textContent = loggedIn ? user.username : '';
      navUser.hidden = !loggedIn;
      navUser.style.display = loggedIn ? 'inline-block' : 'none';
    }
    if (logoutBtn) logoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
    if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : 'inline-block';
    if (regBtn) regBtn.style.display = loggedIn ? 'none' : 'inline-block';
    if (profileLink) profileLink.style.display = loggedIn ? '' : 'none';
  };

  const mergeGuestCart = () => {};

  const Auth = {
    getToken() {
      return '';
    },
    getUser() {
      return sessionUser;
    },
    isLoggedIn() {
      return !!(sessionUser && sessionUser.username);
    },
    isAdmin() {
      return !!(sessionUser && sessionUser.role === 'admin');
    },
    openLogin() {
      const modal = $('#loginModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('open');
      document.body.classList.add('modal-open');
    },
    closeModals() {
      $$('.modal.open').forEach((modal) => {
        modal.classList.remove('open');
        modal.classList.add('hidden');
      });
      document.body.classList.remove('modal-open');
    },
    setSession(tokenOrUser, maybeUser) {
      const user = (maybeUser !== undefined) ? maybeUser : tokenOrUser;
      sessionUser = normalizeUser(user);
      updateNav(sessionUser);
      mergeGuestCart(sessionUser);
      window.dispatchEvent(new Event('auth:changed'));
    },
    clearSession(options = {}) {
      const opts = options || {};
      sessionUser = null;
      updateNav(null);
      if (!opts.skipServer) {
        fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      }
      window.dispatchEvent(new Event('auth:changed'));
    },
    async refreshFromServer() {
      try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!res.ok) throw new Error('unauthenticated');
        const data = await res.json().catch(() => ({}));
        const user = normalizeUser(data?.user);
        if (!user) throw new Error('unauthenticated');
        this.setSession(user);
        return user;
      } catch (_) {
        this.clearSession({ skipServer: true });
        return null;
      }
    }
  };

  window.Auth = Auth;

  document.addEventListener('DOMContentLoaded', () => {
    updateNav(null);
    Auth.refreshFromServer();

    $('#loginClose')?.addEventListener('click', Auth.closeModals);
    $('#registerClose')?.addEventListener('click', Auth.closeModals);

    $('#loginBtn')?.addEventListener('click', Auth.openLogin);
    $('#registerBtn')?.addEventListener('click', () => {
      const modal = $('#registerModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('open');
      document.body.classList.add('modal-open');
    });

    $('#logoutBtn')?.addEventListener('click', () => {
      Auth.clearSession();
      const badge = $('#cartCount');
      if (badge) {
        badge.style.display = 'none';
        badge.textContent = '0';
      }
      if (location.pathname.endsWith('/admin.html')) location.href = './index.html';
      else location.reload();
    });

    const loginForm = $('#loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const username = $('#loginUsername')?.value?.trim() || '';
        const password = $('#loginPassword')?.value || '';

        try {
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'login failed');

          Auth.setSession(payload.user);
          Auth.closeModals();

          if (payload.user?.role === 'admin' && !location.pathname.endsWith('/admin.html')) {
            location.href = './admin.html';
            return;
          }
          location.reload();
        } catch (_) {
          window.toast?.('Invalid credentials');
          alert('ログインに失敗しました。');
        }
      });
    }

    const registerForm = $('#registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const username = $('#regUsername')?.value?.trim() || '';
        const email = $('#regEmail')?.value?.trim() || '';
        const password = $('#regPassword')?.value || '';

        try {
          const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'register failed');

          alert('登録しました。ログインしてください。');
          Auth.closeModals();
          Auth.openLogin();
        } catch (_) {
          alert('登録に失敗しました。');
        }
      });
    }
  });
})();
