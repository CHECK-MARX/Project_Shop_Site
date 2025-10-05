/* checkout.js — 決済フォーム（合計表示 / 入力チェック / 決済呼び出し / 完了ページへ遷移） */
(() => {
  'use strict';

  // ローカルヘルパ（グローバルと衝突しない）
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;

  const FallbackAuth = {
    getToken(){ return localStorage.getItem('token') || ''; },
    getUser(){ try { return JSON.parse(localStorage.getItem('auth_user')||''); } catch { return null; } },
    isLoggedIn(){ return !!localStorage.getItem('token'); },
    openLogin(){
      const m = $('#loginModal');
      if (m){ m.classList.remove('hidden'); m.classList.add('open'); document.body.classList.add('modal-open'); }
    }
  };
  const Auth = (window.Auth ?? FallbackAuth);

  // カートAPI（既存があれば優先）
  function cartKey(){
    const u = Auth.getUser?.();
    return `cart:${u?.username || 'guest'}`;
  }
  const getCart = (typeof window.getCart === 'function')
    ? window.getCart
    : () => { try { return JSON.parse(localStorage.getItem(cartKey())||'[]'); } catch { return []; } };

  const setCart = (typeof window.setCart === 'function')
    ? window.setCart
    : (list) => {
        localStorage.setItem(cartKey(), JSON.stringify(list));
        try { window.updateCartBadge && window.updateCartBadge(); } catch {}
      };

  // 入力バリデーション
  const digits = s => String(s||'').replace(/\D+/g,'');
  function luhnOk(card){
    const s = digits(card);
    if (s.length < 12 || s.length > 19) return false;
    let sum = 0, dbl = false;
    for (let i = s.length - 1; i >= 0; i--){
      let d = s.charCodeAt(i) - 48;
      if (dbl){ d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return (sum % 10) === 0;
  }
  function parseExp(mmYY){
    const m = String(mmYY||'').trim().replace(/\s+/g,'').toUpperCase();
    const t = m.split('/');
    if (t.length !== 2) return null;
    let mm = parseInt(t[0],10);
    let yy = parseInt(t[1],10);
    if (!(mm >= 1 && mm <= 12)) return null;
    yy = (yy < 100) ? 2000 + yy : yy;
    return { mm, yy };
  }
  function expOk(v){
    const p = parseExp(v); if (!p) return false;
    const now = new Date(); const y = now.getFullYear(); const m = now.getMonth() + 1;
    return (p.yy > y) || (p.yy === y && p.mm >= m);
  }
  const cvvOk = v => { const s = digits(v); return s.length === 3 || s.length === 4; };

  // 合計
  function calcTotal(){
    const list = getCart();
    const total = list.reduce((s,i)=> s + (Math.round(Number(i.price)||0) * (Number(i.qty)||0)), 0);
    return { list, total };
  }
  function renderTotal(){
    const { total } = calcTotal();
    const el = $('#checkoutTotal');
    if (el) el.textContent = fmtJPY(total);
  }

  // 決済
  async function doPay(ev){
    ev?.preventDefault?.();

    if (!Auth.isLoggedIn?.()){
      try { window.toast && window.toast('ログインが必要です'); } catch {}
      Auth.openLogin?.();
      return;
    }

    const name = $('#cardName')?.value || '';
    const num  = $('#cardNumber')?.value || '';
    const exp  = $('#cardExp')?.value || '';
    const cvv  = $('#cardCvv')?.value || '';

    const errs = [];
    if (!name.trim())  errs.push('氏名');
    if (!luhnOk(num))  errs.push('カード番号');
    if (!expOk(exp))   errs.push('有効期限');
    if (!cvvOk(cvv))   errs.push('CVV');

    const { list, total } = calcTotal();
    if (!list.length || total <= 0) errs.push('カート');

    if (errs.length){
      try { window.toast && window.toast(`入力を確認してください: ${errs.join(' / ')}`); } catch {}
      return;
    }

    const btn = $('#payBtn') || $('#checkoutForm button[type="submit"]');
    const old = btn?.textContent;
    if (btn){ btn.disabled = true; btn.textContent = '処理中…'; }

    try{
      const token = Auth.getToken?.() || '';
      const payloadItems = list.map(i => ({
        id: (i.id ?? i.productId),        // どちらでもOK
        qty: (Number(i.qty) || 1)
      }));

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Accept':'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          items: payloadItems,             // 価格はサーバ参照
          cardLast4: digits(num).slice(-4),
          name: name.trim()
        })
      });

      let body;
      try { body = await res.json(); }
      catch { body = { ok:false, error: await res.text().catch(()=>`HTTP_${res.status}`) }; }

      if (!res.ok || !body?.ok){
        console.error('CHECKOUT_FAILED', res.status, body);
        throw new Error(body?.error || `CHECKOUT_FAILED_${res.status}`);
      }

      // ← 成功したときだけクリア・バッジ更新
      setCart([]);
      try { window.toast && window.toast(`支払い完了（注文ID: ${body.orderId}）`); } catch {}
      try { const badge = $('#cartCount'); if (badge) badge.textContent = '0'; } catch {}
      setTimeout(()=>{ location.href = `/order-complete.html?ref=${encodeURIComponent(body.orderId)}`; }, 500);
    } catch(e){
      console.error(e);
      try { window.toast && window.toast('決済に失敗しました'); } catch {}
      // 失敗時は何もしない（カート保持・バッジも維持）
    } finally {
      if (btn){ btn.disabled = false; btn.textContent = old || '支払う'; }
      renderTotal(); // 表示だけ再計算（カートは成功時以外は保持）
    }
  }

  function wireCheckout(){
    renderTotal();
    const form = $('#checkoutForm') || $('form');
    if (form){ form.addEventListener('submit', doPay); } // click の重複登録はしない
    window.addEventListener('storage', e => {
      if (e?.key && e.key.startsWith('cart:')) renderTotal();
    });
  }

  document.addEventListener('DOMContentLoaded', wireCheckout);
})();
