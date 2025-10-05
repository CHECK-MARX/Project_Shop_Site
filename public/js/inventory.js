// public/js/inventory.js — 在庫管理（名前/価格の編集＋在庫加算）
(() => {
  if (window.__INV_PAGE_WIRED__) return; window.__INV_PAGE_WIRED__ = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmtJPY = window.fmtJPY || (n => `¥${Math.round(Number(n||0)).toLocaleString('ja-JP')}`);
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

  function rowHTML(p){
    const pid = Number(p.id);
    const price = Math.round(Number(p.price)||0);
    const stock = Math.max(0, Number(p.stock)||0);
    return `
      <tr data-id="${pid}">
        <td style="text-align:right;">${pid}</td>
        <td>
          <input class="inv-name" type="text" value="${(p.name || '').replace(/"/g,'&quot;')}" style="width: 240px;">
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="opacity:.85">¥</span>
            <input class="inv-price" type="number" min="0" step="1" value="${price}" style="width:110px;text-align:right;">
          </div>
        </td>
        <td><span class="inv-stock" style="font-weight:700">${stock}</span></td>
        <td>
          <div class="btn-group">
            <button class="btn btn-secondary inv-plus" data-val="1">+1</button>
            <button class="btn btn-secondary inv-plus" data-val="5">+5</button>
            <button class="btn btn-secondary inv-plus" data-val="10">+10</button>
          </div>
        </td>
        <td>
          <input class="inv-add" type="number" step="1" value="0" style="width:70px;text-align:right;">
          <button class="btn btn-success inv-addbtn">追加</button>
        </td>
        <td>
          <button class="btn btn-primary inv-save">保存</button>
        </td>
      </tr>
    `;
  }

  async function load(){
    const tb = $('#invTbody') || $('#inventoryBody') || $('#invBody');
    const table = tb?.closest('table');
    if (!tb) {
      // ページに tbody が無い場合は簡易テーブルを作る
      const main = $('main') || document.body;
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <table class="table">
          <thead>
            <tr><th>ID</th><th>商品名</th><th>価格</th><th>在庫</th><th>操作</th><th>まとめ追加</th><th>保存</th></tr>
          </thead>
          <tbody id="invTbody"></tbody>
        </table>
      `;
      main.appendChild(wrap);
    }
    const tbody = $('#invTbody') || $('#inventoryBody') || $('#invBody');

    try{
      const rows = await api('/api/admin/inventory');
      tbody.innerHTML = rows.map(rowHTML).join('');
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="7" style="color:#ff8a8a">在庫一覧の取得に失敗しました</td></tr>`;
    }
  }

  // クリック系（イベントデリゲート）
  document.addEventListener('click', async (ev)=>{
    const tr = ev.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);

    // ＋ボタン
    const plus = ev.target.closest('.inv-plus');
    if (plus){
      const add = tr.querySelector('.inv-add');
      add.value = String(Math.round(Number(add.value)||0) + Math.round(Number(plus.dataset.val)||0));
      return;
    }

    // 在庫 追加
    const addBtn = ev.target.closest('.inv-addbtn');
    if (addBtn){
      const add = Math.round(Number(tr.querySelector('.inv-add')?.value)||0);
      try{
        await api(`/api/admin/products/${id}/stock/add`, { method:'POST', body: JSON.stringify({ add }) });
        toast('在庫を更新しました');
        await load();
      }catch(e){ alert('在庫更新に失敗: '+e.message); }
      return;
    }

    // 名前/価格の保存
    const save = ev.target.closest('.inv-save');
    if (save){
      const name  = String(tr.querySelector('.inv-name')?.value || '').trim();
      let price   = Math.round(Number(tr.querySelector('.inv-price')?.value)||0);
      if (!Number.isFinite(price) || price < 0) price = 0;
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
