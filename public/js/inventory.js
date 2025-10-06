// public/js/inventory.js — 在庫管理（横並び・編集保存 + 売れた個数の表示）
(() => {
  if (window.__INV_PAGE_WIRED__) return; window.__INV_PAGE_WIRED__ = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const token = () => (window.Auth?.getToken?.() || localStorage.getItem('token') || '').trim();

  function toast(msg){
    let host = $('#toaster'); if(!host){ host=document.createElement('div'); host.id='toaster';
      host.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px;';
      document.body.appendChild(host);
    }
    const n = document.createElement('div');
    n.textContent = msg;
    n.style.cssText = 'padding:8px 12px;border-radius:10px;border:1px solid #2b3a5a;background:#0f1729;color:#e9edf6;box-shadow:0 8px 30px rgba(0,0,0,.35);font-weight:600;';
    host.appendChild(n); setTimeout(()=>n.remove(), 1300);
  }

  async function api(path, opt={}){
    const r = await fetch(path, {
      ...opt,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(opt.headers || {})
      }
    });
    const b = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(b.error || r.status);
    return b;
  }

  // 1行HTML（sold は表示のみ・操作なし）
  function rowHTML(p, soldMap){
    const id    = Number(p.id);
    const name  = String(p.name || '');
    const price = Math.round(Number(p.price) || 0);
    const stock = Math.max(0, Number(p.stock) || 0);
    const sold  = Math.max(0, Number(soldMap.get(id) || 0));
    return `
      <tr data-id="${id}">
        <td style="text-align:right;">${id}</td>
        <td><input class="inv-input inv-name" type="text" value="${name.replace(/"/g,'&quot;')}"></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="opacity:.8">¥</span>
            <input class="inv-input inv-price" type="number" min="0" step="1" value="${price}">
          </div>
        </td>
        <td><span class="inv-stock">${stock}</span></td>
        <td class="inv-ops">
          <div class="btn-group">
            <button class="btn btn-secondary btn-sm op-plus" data-val="1">+1</button>
            <button class="btn btn-secondary btn-sm op-plus" data-val="5">+5</button>
            <button class="btn btn-secondary btn-sm op-plus" data-val="10">+10</button>
          </div>
          <input class="inv-input inv-add" type="number" step="1" value="0" title="追加数">
          <button class="btn btn-success btn-sm op-add">追加</button>
          <button class="btn btn-primary btn-sm op-save">保存</button>
          <span class="inv-sold" title="過去の決済の累計個数">売れた: <b>${sold}</b></span>
        </td>
      </tr>
    `;
  }

  // tbody を用意（inventory.html の #invTbody に書き込む）
  function tbodyEl(){ return $('#invTbody'); }

  async function load(){
    const body = tbodyEl(); if (!body) return;
    try{
      // 商品一覧と売上集計を同時取得
      const [prods, sales] = await Promise.all([
        api('/api/products'),
        api('/api/admin/sales-summary').catch(()=>[])
      ]);
      const soldMap = new Map((sales||[]).map(x => [Number(x.product_id), Number(x.sold)||0]));
      body.innerHTML = prods.map(p => rowHTML(p, soldMap)).join('');
    }catch(e){
      console.error(e);
      body.innerHTML = `<tr><td colspan="5" style="color:#ff8a8a">在庫一覧の取得に失敗しました</td></tr>`;
    }
  }

  // 操作（+ / 追加 / 保存）
  document.addEventListener('click', async (ev)=>{
    const tr = ev.target.closest('tr[data-id]'); if (!tr) return;
    const id = Number(tr.dataset.id);

    // +1/+5/+10
    const plus = ev.target.closest('.op-plus');
    if (plus){
      const add = tr.querySelector('.inv-add');
      add.value = String((Math.round(Number(add.value)||0)) + Math.round(Number(plus.dataset.val)||0));
      return;
    }

    // 在庫追加
    const addBtn = ev.target.closest('.op-add');
    if (addBtn){
      let add = Math.round(Number(tr.querySelector('.inv-add')?.value)||0);
      if (add <= 0) { toast('追加数は1以上を入力'); return; }
      try{
        await api(`/api/admin/products/${id}/stock/add`, { method:'POST', body: JSON.stringify({ add }) });
        toast('在庫を更新しました');
        await load();
      }catch(e){ alert('在庫更新に失敗: '+e.message); }
      return;
    }

    // 名前・価格の保存
    const saveBtn = ev.target.closest('.op-save');
    if (saveBtn){
      const name  = String(tr.querySelector('.inv-name')?.value || '').trim();
      let price   = Math.round(Number(tr.querySelector('.inv-price')?.value)||0);
      if (!name)  { toast('商品名を入力してください'); return; }
      if (price < 0 || !Number.isFinite(price)) price = 0;
      try{
        await api(`/api/admin/products/${id}`, { method:'PUT', body: JSON.stringify({ name, price }) });
        toast('商品情報を更新しました');
        await load();
      }catch(e){ alert('保存に失敗: '+e.message); }
      return;
    }
  });

  document.addEventListener('DOMContentLoaded', load);
})();
