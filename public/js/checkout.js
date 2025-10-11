// public/js/checkout.js
// カート合計の表示 + 簡易バリデーション + 決済API連携

(() => {
  'use strict';
  if (window.__CHECKOUT_WIRED__) return;
  window.__CHECKOUT_WIRED__ = true;

  // ---- helpers ----
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;

  // Auth は script.js で公開済み（なければ簡易フォールバック）
  const Auth = window.Auth || {
    getToken(){ return localStorage.getItem('token') || ''; },
    getUser(){ try{ return JSON.parse(localStorage.getItem('auth_user')||'null'); }catch{return null;} },
    isLoggedIn(){ return !!localStorage.getItem('token'); }
  };

  // script.js と同じロジックで cart:<username|guest> を読む
  function cartKey(){
    const u = (Auth.getUser && Auth.getUser()) || null;
    return `cart:${u?.username || 'guest'}`;
  }
  function getCart(){
    try { return JSON.parse(localStorage.getItem(cartKey()) || '[]'); }
    catch { return []; }
  }
  function setCart(list){
    localStorage.setItem(cartKey(), JSON.stringify(list || []));
    window.dispatchEvent(new StorageEvent('storage', { key: cartKey() })); // 他UI更新用
  }

  async function apiAuthPost(url, body){
    const t = (Auth.getToken?.() || '').trim();
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {})
      },
      body: JSON.stringify(body||{})
    });
    const d = await r.json().catch(()=> ({}));
    if (!r.ok) {
      const err = new Error(d.error || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return d;
  }

  // ---- DOM refs ----
  const form   = $('#checkoutForm') || $('form');
  const nameEl = $('#name') || $$('input')[0];
  const cardEl = $('#card') || $$('input')[1];
  const expEl  = $('#exp')  || $$('input')[2];
  const cvvEl  = $('#cvv')  || $$('input')[3];
  const btn    = $('#payBtn') || $$('button[type="submit"]').find(b=>/支払う/.test(b.textContent)) || $$('button')[0];
  const totalEl= $('#checkoutTotal') || $('#total') || $('.sum-ttl + div') || $$('.sum-row div')[1];

  // ---- 合計計算（ローカルの価格でOK。価格が無い場合は0として表示） ----
  function calcTotals(){
    const items = getCart();
    let subtotal = 0;
    for (const it of items) {
      const price = Math.round(Number(it.price)||0);
      const qty   = Math.max(1, Number(it.qty)||0);
      subtotal += price * qty;
    }
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;

    if (totalEl) totalEl.textContent = fmtJPY(total);
    // カートが空 or 未ログインならボタン止める（サーバでは 401/400 を返すので二重保険）
    btn && (btn.disabled = (!items.length || !(Auth.isLoggedIn?.())));
    return { items, subtotal, tax, total };
  }

  // ---- 入力バリデーション（ライト） ----
  function validate(){
    const name = String(nameEl?.value||'').trim();
    const card = String(cardEl?.value||'').replace(/\s|-/g,'');
    const exp  = String(expEl?.value||'').replace(/\s/g,'').replace('/', '');
    const cvv  = String(cvvEl?.value||'').trim();

    if (!name) { alert('氏名を入力してください。'); return null; }
    if (!/^\d{13,19}$/.test(card)) { alert('カード番号を確認してください。'); return null; }
    if (!/^\d{4}$/.test(exp)) { alert('有効期限（MM/YY）を入力してください。'); return null; }
    const mm = parseInt(exp.slice(0,2), 10);
    const yy = parseInt(exp.slice(2,4), 10);
    if (!(mm>=1 && mm<=12)) { alert('有効期限（月）が不正です。'); return null; }
    if (!/^\d{3,4}$/.test(cvv)) { alert('CVV を確認してください。'); return null; }

    return { name, card, expMM: mm, expYY: yy, cvv };
  }

  // ---- 送信 ----
  async function onSubmit(e){
    e && e.preventDefault();

    const v = validate(); if (!v) return;

    const { items, subtotal, tax, total } = calcTotals();
    if (!items.length) { alert('カートが空です。'); return; }

    try{
      btn && (btn.disabled = true);
      // サーバは productId または id / qty を解釈する
      const payload = {
        items: items.map(i => ({
          id: Number(i.productId || i.id),
          productId: Number(i.productId || i.id),
          qty: Math.max(1, Number(i.qty)||0)
        })),
        name: v.name,
        cardLast4: v.card.slice(-4)
      };

      const res = await apiAuthPost('/api/checkout', payload);
      // 成功：カートを空にし、完了ページへ
      setCart([]);
      location.href = `./order-complete.html?ref=${encodeURIComponent(res.orderId || '')}`;
    }catch(err){
      if (err.status === 401) alert('ログインが必要です。管理画面の「ログイン」から再度ログインしてください。');
      else if (err.status === 409) alert('在庫を超えています。カート内容を見直してください。');
      else alert('決済に失敗しました。しばらくしてからお試しください。');
    }finally{
      btn && (btn.disabled = false);
    }
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', ()=>{
    calcTotals();
    form && form.addEventListener('submit', onSubmit);

    // 他タブでのカート変更・ログイン状態変化にも追随
    window.addEventListener('storage', ev=>{
      if (!ev.key) return;
      if (ev.key === cartKey() || ev.key === 'token' || ev.key === 'auth_user') calcTotals();
    });
  });
})();
