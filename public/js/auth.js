// public/js/auth.js
(() => {
  // 二重読込ガード
  if (window.__AUTH_WIRED__) return;
  window.__AUTH_WIRED__ = true;

  const $  = (s) => document.querySelector(s);
  const $id= (id)=> document.getElementById(id);
  const on = (el,ev,fn)=> el && el.addEventListener(ev,fn);

  // 旧ダミートークンの掃除
  try {
    if (localStorage.getItem('token') === 'root-admin-token') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  } catch {}

  // ---- モーダル：フォールバック定義（無ければ用意）----
  if (typeof window.openModal !== 'function') {
    window.openModal = function(id){
      const el = $id(id); if(!el) return;
      el.classList.remove('hidden'); el.classList.add('open');
      el.setAttribute('aria-hidden','false');
      document.body.classList.add('modal-open');
      // フォーカス
      (el.querySelector('input,button,select,textarea')||{}).focus?.();
    };
  }
  if (typeof window.closeModal !== 'function') {
    window.closeModal = function(id){
      const el = $id(id); if(!el) return;
      el.classList.remove('open'); el.classList.add('hidden');
      el.setAttribute('aria-hidden','true');
      document.body.classList.remove('modal-open');
    };
  }
  const closeModalSafe = (id)=>{ try{ window.closeModal(id); }catch{} };
  const uiUpdateSafe   = ()=>{ try{ typeof window.updateAuthUI==='function' && window.updateAuthUI(); }catch{} };

  // ---- ボタン配線（必ず動くように）----
  document.addEventListener('DOMContentLoaded', () => {
    on($id('loginBtn'),    'click', ()=> window.openModal('loginModal'));
    on($id('registerBtn'), 'click', ()=> window.openModal('registerModal'));
    on($id('logoutBtn'),   'click', () => {
      // ログアウト：トークン等クリア
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      uiUpdateSafe();
      alert('ログアウトしました');
      // 可能ならホームへ
      try { if (!location.pathname.endsWith('/index.html')) location.href = './index.html'; } catch {}
    });

    // ×ボタン
    on($id('loginClose'),    'click', ()=> closeModalSafe('loginModal'));
    on($id('registerClose'), 'click', ()=> closeModalSafe('registerModal'));

    // 背景クリックで閉じる
    window.addEventListener('click', (e)=>{
      const m = e.target;
      if (m?.classList?.contains('modal')) closeModalSafe(m.id);
    });
  });

  // ---- API util ----
  async function postJSON(url, body){
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body||{})
    });
    const data = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
    return data;
  }

  // ---- 新規登録 ----
  on($('#registerForm'), 'submit', async (e) => {
    e.preventDefault();
    const username = $('#regUsername')?.value?.trim();
    const email    = $('#regEmail')?.value?.trim() || '';
    const password = $('#regPassword')?.value || '';
    if (!username || !password) { alert('ユーザー名とパスワードを入力してください'); return; }

    try {
      const data = await postJSON('/api/register', { username, email, password });
      alert(`登録OK: userId=${data.userId}`);
      closeModalSafe('registerModal');
      // 直後にログインモーダルを開く（任意）
      setTimeout(()=>{ try{ window.openModal('loginModal'); }catch{} }, 60);
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    }
  });

  // ---- ログイン ----
  on($('#loginForm'), 'submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername')?.value?.trim();
    const password = $('#loginPassword')?.value || '';
    if (!username || !password) { alert('ユーザー名とパスワードを入力してください'); return; }

    try {
      const data = await postJSON('/api/login', { username, password });

      // 保存
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      alert(`ログインOK: ${data.user?.username || username}`);
      closeModalSafe('loginModal');
      uiUpdateSafe();

      // 管理者なら管理画面へ
      if (data.user?.role === 'admin') {
        location.href = './admin.html';
      }
    } catch (err) {
      console.error(err);
      alert('ログインエラー: ' + err.message);
    }
  });

  console.log('auth.js wired');
})();
