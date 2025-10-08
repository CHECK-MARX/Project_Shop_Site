(() => {
  'use strict';
// === 認証/管理者チェック（inventory.js の先頭付近に置く） ===
async function fetchMe() {
  const t = localStorage.getItem('token') || '';
  if (!t) return null;
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function ensureAdmin() {
  const msg = document.getElementById('invMsg');
  const me = await fetchMe();
  if (!me || !me.user) {
    if (msg) msg.textContent = '認証が切れました。ログインし直してください。';
    return false;
  }
  if (me.user.role !== 'admin') {
    if (msg) msg.textContent = 'このページは管理者専用です。';
    return false;
  }
  if (msg) msg.textContent = ''; // OK
  return true;
}

// 既存の DOMContentLoaded 初期化をこれでラップ
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await ensureAdmin();
  if (!ok) return;           // ここで止める（無限にAPI叩かない）
  // 以降、既存の loadAll() や描画処理を呼ぶ
  try { typeof loadAll === 'function' && loadAll(); } catch {}
});

  // helpers
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`;

  // simple Auth bridge
  const Auth = {
    token(){ return localStorage.getItem('token') || ''; },
    async me(){
      const t = this.token();
      if (!t) return null;
      try{
        const r = await fetch('/api/me', { headers:{ Authorization:`Bearer ${t}` }});
        if (!r.ok) return null;
        return (await r.json())?.user ?? null;
      }catch{ return null; }
    }
  };

  async function apiAuthGet(url){
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${Auth.token()}` }});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function apiAuthJSON(url, method, body){
    const r = await fetch(url, {
      method,
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${Auth.token()}`
      },
      body: JSON.stringify(body||{})
    });
    const d = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
    return d;
  }

  // UI
  const tbody  = document.getElementById('invBody') || document.querySelector('tbody');
  const msgTop = document.getElementById('invMsg') || (()=>{ const m=document.createElement('div'); m.id='invMsg'; m.style.margin='8px 0'; (tbody?.parentElement||document.body).prepend(m); return m; })();

  function toast(text, ok=false){
    msgTop.textContent = text;
    msgTop.style.color = ok ? '#69f0ae' : '#ff6b6b';
    setTimeout(()=>{ msgTop.textContent=''; }, 2500);
  }

  // main loader
  async function loadAll(){
    const me = await Auth.me();
    if (!me || me.role !== 'admin'){
      if (tbody) tbody.innerHTML = `<tr><td colspan="99" style="padding:16px">管理者としてログインしてください。</td></tr>`;
      return;
    }

    let products = [];
    let soldMap  = new Map();
    try{
      const [p, sales] = await Promise.all([
        fetch('/api/products').then(r=>r.json()),
        apiAuthGet('/api/admin/sales-summary').catch(()=> [])
      ]);
      products = Array.isArray(p) ? p : [];
      if (Array.isArray(sales)){
        for (const s of sales){
          const pid  = Number(s.product_id);
          const sold = Math.max(0, Number(s.sold)||0);
          soldMap.set(pid, sold);
        }
      }
    }catch(e){
      console.error(e);
      toast('在庫情報の読み込みに失敗しました');
      products = [];
      soldMap  = new Map();
    }

    if (!tbody) return;
    if (!products.length){
      tbody.innerHTML = `<tr><td colspan="99" style="padding:16px">商品がありません。</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map(p=>{
      const id    = Number(p.id);
      const name  = p.name ?? '';
      const price = Math.round(Number(p.price)||0);
      const stock = Math.max(0, Number(p.stock)||0);
      const sold  = soldMap.get(id) ?? 0;

      return `
      <tr data-id="${id}">
        <td>${id}</td>
        <td><input class="num-in name-in"  data-k="name"  value="${String(name).replace(/"/g,'&quot;')}" style="width:100%"></td>
        <td><input class="num-in price-in" data-k="price" type="number" step="1" value="${price}"></td>
        <td class="stock">${stock}</td>
        <td class="ctrls">
          <div class="btn-row">
            <button class="mini add-1"  type="button">+1</button>
            <button class="mini add-5"  type="button">+5</button>
            <button class="mini add-10" type="button">+10</button>
          </div>
          <div class="sold-wrap">売れた: <b class="sold-val">${sold.toLocaleString('ja-JP')}</b></div>
          <button class="btn save" type="button">保存</button>
        </td>
        <td><input class="num-in add-in" type="number" value="0" placeholder="0"></td>
        <td><button class="btn do-add" type="button">追加</button></td>
      </tr>`;
    }).join('');

    // events
    $$('#invBody tr', document).forEach(tr=>{
      const id      = Number(tr.getAttribute('data-id'));
      const nameIn  = tr.querySelector('.name-in');
      const priceIn = tr.querySelector('.price-in');
      const addIn   = tr.querySelector('.add-in');

      tr.querySelector('.add-1') ?.addEventListener('click', ()=>{ addIn.value = String((Number(addIn.value)||0) + 1 ); });
      tr.querySelector('.add-5') ?.addEventListener('click', ()=>{ addIn.value = String((Number(addIn.value)||0) + 5 ); });
      tr.querySelector('.add-10')?.addEventListener('click', ()=>{ addIn.value = String((Number(addIn.value)||0) +10 ); });

      tr.querySelector('.save')?.addEventListener('click', async ()=>{
        const payload = {};
        const newName  = String(nameIn.value||'').trim();
        const newPrice = Math.round(Number(priceIn.value)||0);
        if (newName !== '')  payload.name  = newName;
        if (Number.isFinite(newPrice)) payload.price = newPrice;
        if (!Object.keys(payload).length){ toast('変更がありません'); return; }

        try{
          await apiAuthJSON(`/api/admin/products/${id}`, 'PUT', payload);
          toast('保存しました', true);
          await loadAll();
        }catch(e){
          console.error(e);
          toast('保存に失敗しました');
        }
      });

      tr.querySelector('.do-add')?.addEventListener('click', async ()=>{
        let add = Math.round(Number(addIn.value));
        if (!Number.isFinite(add) || add === 0){ toast('数量を入力してください'); return; }
        try{
          const d = await apiAuthJSON(`/api/admin/products/${id}/stock/add`, 'POST', { add });
          tr.querySelector('.stock').textContent = String(Math.max(0, Number(d.stock)||0));
          addIn.value = '0';
          toast('在庫を更新しました', true);
        }catch(e){
          console.error(e);
          toast('在庫更新に失敗しました');
        }
      });
    });
  }

  // init
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('btnSalesHistory');
    if (btn) btn.addEventListener('click', ()=>{ location.href = './sales-history.html'; });
    loadAll();
  });
})();
