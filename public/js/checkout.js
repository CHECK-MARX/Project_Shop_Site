/* checkout.js — 決済ページ専用。グローバル衝突を避けるため必ず IIFE で包む */
(() => {
  // --- 安全なローカルユーティリティ（グローバルに出さない） ---
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;

  // 既存 Auth があればそれを使い、無ければ簡易フォールバック
  const Auth = window.Auth || {
    getToken(){ return localStorage.getItem('token') || ''; },
    getUser(){ try { return JSON.parse(localStorage.getItem('auth_user')||''); } catch { return null; } },
    isLoggedIn(){ return !!localStorage.getItem('token'); },
    openLogin(){
      const m = $('#loginModal');
      if (m) { m.classList.remove('hidden'); m.classList.add('open'); document.body.classList.add('modal-open'); }
    }
  };

  // script.js の getCart を使いたいが、ページ単独でも動くよう最小フォールバック
  function cartKey(){
    const u = (Auth.getUser && Auth.getUser()) || null;
    return `cart:${u?.username || 'guest'}`;
  }
  function getCart(){
    try { return JSON.parse(localStorage.getItem(cartKey()) || '[]'); } catch { return []; }
  }
  function setCart(list){
    localStorage.setItem(cartKey(), JSON.stringify(list));
    try { window.updateCartBadge && window.updateCartBadge(); } catch {}
  }
  function toast(msg){
    let t = $('#toaster'); if(!t){ t=document.createElement('div'); t.id='toaster'; document.body.appendChild(t); }
    const n = document.createElement('div'); n.textContent = msg; t.appendChild(n);
    setTimeout(()=> n.remove(), 1500);
  }

  // --- 入力チェック（ローカル実装） ---
  const digitsOnly = s => String(s||'').replace(/\D+/g, '');
  function luhnValid(card){
    const s = digitsOnly(card);
    if (s.length < 12 || s.length > 19) return false;
    let sum = 0, dbl = false;
    for (let i = s.length-1; i >= 0; i--){
      let d = s.charCodeAt(i) - 48;
      if (dbl){ d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  function parseExpiry(mmYY){
    const m = String(mmYY||'').trim().replace(/\s+/g,'').toUpperCase();
    const a = m.split('/');
    if (a.length !== 2) return null;
    const mm = parseInt(a[0],10), yy2 = parseInt(a[1],10);
    if (!(mm >= 1 && mm <= 12)) return null;
    const yy = yy2 < 100 ? 2000 + yy2 : yy2;
    return { mm, yy };
  }
  function expiryValid(exp){
    const p = parseExpiry(exp); if (!p) return false;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth()+1;
    return (p.yy > y) || (p.yy === y && p.mm >= m);
  }
  const cvvValid = cvv => { const s = digitsOnly(cvv); return s.length === 3 || s.length === 4; };

  // --- 合計とアイテム ---
  function currentAmountAndItems(){
    const list = getCart();
    const total = list.reduce((s,i)=> s + Math.round(Number(i.price)||0)*(Number(i.qty)||0), 0);
    return { total, items: list };
  }

  // --- フォーム配線 ---
  function wire(){
    const nameEl = $('#cardName');
    const numEl  = $('#cardNumber');
    const expEl  = $('#cardExp');
    const cvvEl  = $('#cardCvv');
    const form   = $('#checkoutForm');
    const btn    = $('#payBtn');
    const status = $('#payStatus');
    const sumEl  = $('#checkoutTotal');

    if (!form || !nameEl || !numEl || !expEl || !cvvEl || !btn) return;

    // 合計表示
    try { const { total } = currentAmountAndItems(); if (sumEl) sumEl.textContent = fmtJPY(total); } catch {}

    // 直前の「No token」メッセージを消しておく
    if (status) status.textContent = '';

    const handler = async (ev) => {
      ev?.preventDefault?.();

      // ログイン必須
      if (!Auth.isLoggedIn || !Auth.isLoggedIn()){
        toast('ログインが必要です'); Auth.openLogin && Auth.openLogin(); return;
      }

      const { total, items } = currentAmountAndItems();
      if (!items.length || total <= 0){ toast('カートが空です'); return; }

      const nm  = nameEl.value.trim();
      const num = numEl.value;
      const exp = expEl.value;
      const cvv = cvvEl.value;

      const errs = [];
      if (!nm) errs.push('氏名');
      if (!luhnValid(num)) errs.push('カード番号');
      if (!expiryValid(exp)) errs.push('有効期限');
      if (!cvvValid(cvv)) errs.push('CVV');

      if (errs.length){ toast(`入力を確認してください: ${errs.join(' / ')}`); return; }

      const tok = (Auth.getToken && Auth.getToken()) || '';
      if (!tok){ if (status) status.textContent = '決済失敗: No token'; toast('ログインが切れました'); return; }

      const old = btn.textContent; btn.disabled = true; btn.textContent = '処理中…';

      try{
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: {
            'Content-Type':'application/json',
            'Authorization': `Bearer ${tok}`
          },
          body: JSON.stringify({
            amount: total,
            items: items.map(i=>({ id:i.productId, qty:i.qty, price:i.price })),
            cardLast4: digitsOnly(num).slice(-4),
            name: nm
          })
        });
        const data = await res.json().catch(()=> ({}));
        if (!res.ok || !data?.ok) throw new Error(`checkout failed: ${res.status}`);

        // 成功
        if (status) status.textContent = `支払い完了（注文ID: ${data.orderId}）`;
        setCart([]); // クリア
        toast('支払いが完了しました');

        // カート画面へ（空のカートが表示されます）
        setTimeout(()=> location.href = './cart.html', 600);
      }catch(err){
        console.error(err);
        if (status) status.textContent = '決済に失敗しました';
        toast('決済に失敗しました');
      }finally{
        btn.disabled = false; btn.textContent = old || '支払う';
      }
    };

    form.addEventListener('submit', handler);
    btn.addEventListener('click', handler);
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
