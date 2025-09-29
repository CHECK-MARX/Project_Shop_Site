// public/js/auth.js — 使い回し入力が残らない版
(() => {
  if (window.__AUTH_WIRED__) return;
  window.__AUTH_WIRED__ = true;

  const $ = (s) => document.querySelector(s);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // ------- 安全な UI ユーティリティ -------
  function uiUpdateSafe(){
    try { typeof window.updateAuthUI === 'function' && window.updateAuthUI(); } catch {}
  }
  function fallbackOpen(id){
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('hidden'); m.classList.add('open');
    m.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    // 最初の入力にフォーカス
    const target = m.querySelector('input,button,select,textarea');
    if (target) setTimeout(()=>target.focus(), 0);
  }
  function fallbackClose(id){
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('open'); m.classList.add('hidden');
    m.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
  }

  // ------- 入力クリア関連 -------
  const reg = {
    form: null, user: null, mail: null, pass: null, modal: null, closeBtn: null
  };
  const login = {
    form: null, user: null, pass: null, modal: null, closeBtn: null
  };

  function fillRefs(){
    // register
    reg.form = $('#registerForm');
    reg.user = $('#regUsername');
    reg.mail = $('#regEmail');
    reg.pass = $('#regPassword');
    reg.modal = $('#registerModal');
    reg.closeBtn = $('#registerClose');
    // login
    login.form = $('#loginForm');
    login.user = $('#loginUsername');
    login.pass = $('#loginPassword');
    login.modal = $('#loginModal');
    login.closeBtn = $('#loginClose');
  }
  fillRefs();

  function clearRegisterForm(){
    if (!reg.form) return;
    // form.reset() だけだとブラウザの自動補完が残ることがあるため、明示的に空にする
    ['value','defaultValue'].forEach(k => {
      if (reg.user) reg.user[k] = '';
      if (reg.mail) reg.mail[k] = '';
      if (reg.pass) reg.pass[k] = '';
    });
    // オートコンプリート抑制
    [reg.user, reg.mail, reg.pass].forEach(inp=>{
      if (inp) {
        inp.setAttribute('autocomplete','off');
        // Edge/Chrome の頑固なオートフィル対策で遅延上書き
        setTimeout(()=>{ try{inp.value='';}catch{} }, 0);
      }
    });
  }
  function clearLoginForm(){
    if (!login.form) return;
    ['value','defaultValue'].forEach(k => {
      if (login.user) login.user[k] = '';
      if (login.pass) login.pass[k] = '';
    });
    [login.user, login.pass].forEach(inp=>{
      if (inp) {
        inp.setAttribute('autocomplete','off');
        setTimeout(()=>{ try{inp.value='';}catch{} }, 0);
      }
    });
  }

  // ------- openModal フック（開く直前に必ずクリア） -------
  (function patchOpenModal(){
    const orig = window.openModal;
    window.openModal = function(id){
      if (id === 'registerModal') clearRegisterForm();
      if (id === 'loginModal')    clearLoginForm();
      if (typeof orig === 'function') return orig(id);
      return fallbackOpen(id);
    };
  })();

  // ------- closeModal もフック（閉じたらクリア） -------
  (function patchCloseModal(){
    const orig = window.closeModal;
    window.closeModal = function(id){
      if (typeof orig === 'function') orig(id); else fallbackClose(id);
      if (id === 'registerModal') clearRegisterForm();
      if (id === 'loginModal')    clearLoginForm();
    };
  })();

  // 背景クリックで閉じる時もクリアされるよう監視
  [() => reg.modal, () => login.modal].forEach(get => {
    const m = get();
    if (!m) return;
    m.addEventListener('click', (e)=>{
      if (e.target === m) {
        window.closeModal(m.id);
      }
    });
    // class 変化（別コードが閉じた場合）を拾ってクリア
    const obs = new MutationObserver(() => {
      const hidden = m.classList.contains('hidden') || !m.classList.contains('open');
      if (hidden) {
        if (m.id === 'registerModal') clearRegisterForm();
        if (m.id === 'loginModal')    clearLoginForm();
      }
    });
    obs.observe(m, { attributes:true, attributeFilter:['class'] });
  });

  // 「×」ボタン
  on(reg.closeBtn,   'click', ()=> window.closeModal('registerModal'));
  on(login.closeBtn, 'click', ()=> window.closeModal('loginModal'));

  // ------- 上部のボタンから開く時も必ずクリア -------
  on($('#registerBtn'), 'click', ()=> window.openModal('registerModal'));
  on($('#loginBtn'),    'click', ()=> window.openModal('loginModal'));

  // ------- 登録処理 -------
  on($('#registerForm'), 'submit', async (e) => {
    e.preventDefault();
    fillRefs(); // 念のため
    const username = reg.user?.value?.trim();
    const email    = reg.mail?.value?.trim() || '';
    const password = reg.pass?.value || '';
    if (!username || !password) { alert('ユーザー名とパスワードを入力してください'); return; }

    try {
      const r = await fetch('/api/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, email, password })
      });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data.error || '登録に失敗しました');
      alert(`登録OK: userId=${data.userId}`);
      // 登録に成功したら閉じてクリア
      window.closeModal('registerModal');
      clearRegisterForm();
      // ついでにログインモーダルを開きたければ以下を有効化
      // setTimeout(()=> window.openModal('loginModal'), 60);
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    }
  });

  // ------- ログイン処理 -------
  on($('#loginForm'), 'submit', async (e) => {
    e.preventDefault();
    fillRefs();
    const username = login.user?.value?.trim();
    const password = login.pass?.value || '';
    if (!username || !password) { alert('ユーザー名とパスワードを入力してください'); return; }

    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data.error || 'ログインに失敗しました');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      alert(`ログインOK: ${data.user?.username || username}`);
      window.closeModal('loginModal');
      clearLoginForm();
      uiUpdateSafe();

      if (data.user?.role === 'admin') {
        // 管理者は管理画面へ
        location.href = './admin.html';
      }
    } catch (err) {
      console.error(err);
      alert('ログインエラー: ' + err.message);
    }
  });

  // ------- ログアウト -------
  on($('#logoutBtn'), 'click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    uiUpdateSafe();
    alert('ログアウトしました');
    try { if (!location.pathname.endsWith('/index.html')) location.href = './index.html'; } catch{}
  });

  // ------- 初期化：起動ログ & 1回クリア -------
  document.addEventListener('DOMContentLoaded', () => {
    clearRegisterForm();
    clearLoginForm();
    console.log('auth.js wired');
  });
})();
