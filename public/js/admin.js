// public/js/admin.js — Admin：ユーザー＆バックアップ + ナビは script.js に委譲
(() => {
  if (window.__ADMIN_WIRED__) return; window.__ADMIN_WIRED__ = true;
  const $ = s => document.querySelector(s);

  // ---- small utils
  const token = () => localStorage.getItem('token') || '';
  const authHdr = () => ({ Authorization: 'Bearer ' + token(), 'Content-Type':'application/json' });
  const fmtSize = b => (b/1024/1024).toFixed(2) + ' MB';
  const fmtDate = ms => new Date(ms).toLocaleString();

  function toast(msg, ms=1300){
    let host = $('#toaster');
    if(!host){ host=document.createElement('div'); host.id='toaster';
      host.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px;';
      document.body.appendChild(host);
    }
    const el=document.createElement('div');
    el.textContent=msg;
    el.style.cssText='padding:8px 12px;border-radius:10px;border:1px solid #2b3a5a;background:#0f1729;color:#e9edf6;box-shadow:0 6px 24px rgba(0,0,0,.35);font-weight:600;';
    host.appendChild(el); setTimeout(()=>el.remove(), ms);
  }
  async function api(path, opt={}){
    const r = await fetch(path, { ...opt, headers: { ...authHdr(), ...(opt.headers||{}) } });
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  // ===== Users =====
  async function loadUsers(){
    const tbody = $('#userTbody'); if (!tbody) return;
    try{
      const users = await api('/api/admin/users');
      tbody.innerHTML = users.map(u => {
        const isRoot = String(u.username).toLowerCase()==='root';
        const dis = isRoot ? 'disabled title="root は変更不可"' : '';
        return `<tr class="adm-row">
          <td>${u.id}</td>
          <td>${u.username}</td>
          <td><input type="email" value="${u.email||''}" data-uid="${u.id}" class="adm-inp adm-mail" style="width:220px"></td>
          <td><input type="text" value="${u.password||''}" data-uid="${u.id}" class="adm-inp adm-pass" style="width:160px" ${isRoot?'readonly':''}></td>
          <td>${u.role}</td>
          <td>${(u.created_at||'').replace('T',' ').replace('.000Z','')}</td>
          <td>
            <div class="btn-group" style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-xs adm-edit" data-uid="${u.id}" ${dis}>編集</button>
              <button class="btn btn-danger btn-xs adm-del" data-uid="${u.id}" ${isRoot?'disabled':''}>削除</button>
            </div>
          </td>
        </tr>`;
      }).join('');
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr class="adm-row"><td colspan="7" style="color:#ff8a8a">ユーザー読み込み失敗</td></tr>`;
    }
  }

  // 保存/削除
  document.addEventListener('click', async (ev)=>{
    const edit = ev.target.closest('.adm-edit');
    const del  = ev.target.closest('.adm-del');
    if (edit){
      const id = Number(edit.dataset.uid);
      const mail = document.querySelector(`.adm-mail[data-uid="${id}"]`)?.value || '';
      const pass = document.querySelector(`.adm-pass[data-uid="${id}"]`)?.value || '';
      try{
        await api(`/api/admin/users/${id}/email`, { method:'PUT', body: JSON.stringify({ email: mail }) });
        if (pass) await api(`/api/admin/users/${id}/password`, { method:'PUT', body: JSON.stringify({ password: pass }) });
        toast('更新しました');
        await loadUsers();
      }catch(e){ alert('更新失敗: '+e.message); }
    }
    if (del){
      const id = Number(del.dataset.uid);
      if (!confirm(`ユーザー #${id} を削除しますか？`)) return;
      try{
        await api(`/api/admin/users/${id}`, { method:'DELETE' });
        toast('削除しました');
        await loadUsers();
      }catch(e){ alert('削除失敗: '+e.message); }
    }
  });

  // ===== Backups =====
  async function loadBackups(){
    const tbody = $('#backupTbody'); const empty = $('#backupEmpty');
    if (!tbody) return;
    try{
      const list = await api('/api/admin/backups');
      if (!list.length){ tbody.innerHTML=''; empty.style.display='block'; return; }
      empty.style.display='none';
      tbody.innerHTML = list.map(b => `
        <tr class="adm-row">
          <td class="bk-name">${b.filename}</td>
          <td style="text-align:right">${fmtSize(b.size)}</td>
          <td>${fmtDate(b.mtime)}</td>
          <td class="bk-ops">
            <div class="btn-group" style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-warning btn-xs act-restore" data-fn="${encodeURIComponent(b.filename)}">リストア</button>
              <button class="btn btn-danger  btn-xs act-delbk"   data-fn="${encodeURIComponent(b.filename)}">削除</button>
            </div>
          </td>
        </tr>
      `).join('');
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr class="adm-row"><td colspan="4" style="color:#ff8a8a">バックアップ一覧の取得に失敗</td></tr>`;
    }
  }

  // 作成
  $('#backupMake')?.addEventListener('click', async ()=>{
    const name = ($('#backupName')?.value || '').trim();
    try{
      await api('/api/admin/backup', { method:'POST', body: JSON.stringify({ name }) });
      toast('バックアップを作成しました');
      $('#backupName').value = '';
      await loadBackups();
    }catch(e){ alert('バックアップ作成に失敗: '+e.message); }
  });

  // 復元 / 削除
  document.addEventListener('click', async (ev)=>{
    const rs = ev.target.closest('.act-restore');
    const dl = ev.target.closest('.act-delbk');
    if (rs){
      const fn = decodeURIComponent(rs.dataset.fn || '');
      if (!confirm(`"${fn}" からDBをリストアします。現在の DB は上書きされます。よろしいですか？`)) return;
      try{
        await api('/api/admin/restore', { method:'POST', body: JSON.stringify({ filename: fn }) });
        toast('リストアしました（ページを再読み込みしてください）', 2000);
      }catch(e){ alert('リストア失敗: '+e.message); }
    }
    if (dl){
      const fn = decodeURIComponent(dl.dataset.fn || '');
      if (!confirm(`バックアップ "${fn}" を削除しますか？`)) return;
      try{
        await api('/api/admin/backup/' + encodeURIComponent(fn), { method:'DELETE' });
        toast('削除しました');
        await loadBackups();
      }catch(e){ alert('削除失敗: '+e.message); }
    }
  });

  // boot
  document.addEventListener('DOMContentLoaded', async ()=>{
    await loadUsers();
    await loadBackups();

    // === ナビは script.js に任せる（重複防止） ===
    if (typeof window.updateAdminNav === 'function') window.updateAdminNav();

    // 念のため重複があれば除去（href ベース）
    const dedupe = (selector) => {
      const a = Array.from(document.querySelectorAll(selector));
      a.slice(1).forEach(el => el.remove());
    };
    dedupe('.nav-links a[href$="inventory.html"]');
    dedupe('.nav-links a[href$="admin.html"]');
  });
})();
