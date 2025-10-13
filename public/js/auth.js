/* auth.js
 * Shared authentication helpers. Migrated to HttpOnly JWT cookies so the
 * browser no longer stores sensitive data in Web Storage.
 */
(() => {
  'use strict';
  if (window.__AUTH_MODULE_LOADED__) return;
  window.__AUTH_MODULE_LOADED__ = true;

  const LS_USER = 'auth_user';
  const LEGACY_KEYS = ['token', 'jwt', 'jwtToken', 'auth_token', 'authToken'];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const clearLegacyTokens = () => {
    for (const key of LEGACY_KEYS) {
      try { localStorage.removeItem(key); } catch (_) {}
    }
  };
  clearLegacyTokens();

  const updateNav = (user) => {
    const navUser  = $('#navUser');
    const logoutBtn= $('#logoutBtn');
    const loginBtn = $('#loginBtn');
    const regBtn   = $('#registerBtn');

    const loggedIn = !!(user && user.username);

    if (navUser) {
      navUser.textContent = loggedIn ? user.username : '';
      navUser.hidden = !loggedIn;
      navUser.style.display = loggedIn ? 'inline-block' : 'none';
    }
    if (logoutBtn) logoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
    if (loginBtn)  loginBtn.style.display  = loggedIn ? 'none'        : 'inline-block';
    if (regBtn)    regBtn.style.display    = loggedIn ? 'none'        : 'inline-block';
  };

  const mergeGuestCart = (user) => {
    const username = user?.username;
    if (!username) return;
    try {
      const guestRaw = localStorage.getItem('cart:guest');
      if (!guestRaw) return;
      const guestItems = JSON.parse(guestRaw || '[]');
      if (!Array.isArray(guestItems) || guestItems.length === 0) return;

      const userKey = `cart:${username}`;
      const currentItems = JSON.parse(localStorage.getItem(userKey) || '[]') || [];
      guestItems.forEach((item) => {
        const id = Number(item.productId ?? item.id);
        const qty = Math.max(1, Number(item.qty) || 0);
        if (!id || qty <= 0) return;
        const idx = currentItems.findIndex((row) => Number(row.productId ?? row.id) === id);
        if (idx >= 0) currentItems[idx].qty = Math.max(1, Number(currentItems[idx].qty) || 0) + qty;
        else currentItems.push({ ...item, productId: id, qty });
      });
      localStorage.setItem(userKey, JSON.stringify(currentItems));
      localStorage.removeItem('cart:guest');
    } catch (_) {
      /* ignore broken guest cart data */
    }
  };

  const Auth = {
    getToken() {
      clearLegacyTokens();
      return '';
    },
    getUser() {
      try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); }
      catch (_) { return null; }
    },
    isLoggedIn() {
      const user = this.getUser();
      return !!(user && user.username);
    },
    isAdmin() {
      const user = this.getUser();
      return !!(user && user.role === 'admin');
    },
    openLogin() {
      const modal = $('#loginModal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('open');
        document.body.classList.add('modal-open');
      }
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
      clearLegacyTokens();
      try { localStorage.setItem(LS_USER, JSON.stringify(user || {})); } catch (_) {}
      updateNav(user);
      mergeGuestCart(user);
      window.dispatchEvent(new Event('auth:changed'));
    },
    clearSession(options = {}) {
      const opts = options || {};
      clearLegacyTokens();
      try { localStorage.removeItem(LS_USER); } catch (_) {}
      updateNav(null);
      if (!opts.skipServer) {
        fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      }
      window.dispatchEvent(new Event('auth:changed'));
    },
    refreshFromServer: async function refreshFromServer() {
      try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!res.ok) throw new Error('unauthenticated');
        const data = await res.json().catch(() => ({}));
        const user = (data && typeof data === 'object') ? data.user : null;
        if (!user || !user.username) throw new Error('unauthenticated');
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
    const storedUser = Auth.getUser();
    if (storedUser && storedUser.username) {
      updateNav(storedUser);
    } else {
      Auth.refreshFromServer();
    }

    $('#loginClose')?.addEventListener('click', Auth.closeModals);
    $('#registerClose')?.addEventListener('click', Auth.closeModals);

    $('#loginBtn')?.addEventListener('click', Auth.openLogin);
    $('#registerBtn')?.addEventListener('click', () => {
      const modal = $('#registerModal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('open');
        document.body.classList.add('modal-open');
      }
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
        } catch (err) {
          console.error(err);
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
        const email    = $('#regEmail')?.value?.trim() || '';
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
        } catch (err) {
          console.error(err);
          alert('登録に失敗しました。');
        }
      });
    }
  });
})();
