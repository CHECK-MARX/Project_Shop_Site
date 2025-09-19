// public/js/auth.js
(() => {
  const $ = s => document.querySelector(s);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const show = el => { el.classList.remove('hidden'); el.setAttribute('aria-hidden','false'); el.style.display='flex'; };
  const hide = el => { el.classList.add('hidden');   el.setAttribute('aria-hidden','true');  el.style.display='none'; };

  // 要素参照（id は index.html のものと一致させる）
  const mReg   = $('#registerModal');
  const mLogin = $('#loginModal');

  on($('#registerBtn'), 'click', () => show(mReg));
  on($('#loginBtn'),    'click', () => show(mLogin));
  on($('#registerClose'),'click', () => hide(mReg));
  on($('#loginClose'),  'click', () => hide(mLogin));

  // 登録
  on($('#registerForm'), 'submit', async (e) => {
    e.preventDefault();
    const username = $('#regUsername')?.value?.trim();
    const email    = $('#regEmail')?.value?.trim() || '';
    const password = $('#regPassword')?.value || '';
    if (!username || !password) return alert('ユーザー名とパスワードを入力してください');

    try {
      const r = await fetch('/api/register', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username, email, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '登録に失敗しました');
      alert(`登録OK: userId=${data.userId}`);
      hide(mReg);
    } catch (err) {
      console.error(err);
      alert('登録エラー: ' + err.message);
    }
  });

 // ===== ログイン =====
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('loginUsername')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value || '';
  if (!username || !password) return alert('ユーザー名とパスワードを入力してください');

  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'ログインに失敗しました');

    // 成功処理
    localStorage.setItem('token', data.token);
    alert(`ログインOK: ${data.user?.username || username}`);

    // ← ここがポイント：必ず閉じる
    closeModal('loginModal');

    // UI 更新（定義があれば呼ぶ）
    if (typeof updateAuthUI === 'function') updateAuthUI();

  } catch (err) {
    console.error(err);
    alert('ログインエラー: ' + err.message);
  }
});
