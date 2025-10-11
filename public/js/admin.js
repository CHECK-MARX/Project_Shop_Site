// public/js/admin.js — Admin: ユーザー管理 + DBバックアップ
(() => {
  if (window.__ADMIN_JS_LOADED__) return; window.__ADMIN_JS_LOADED__ = true;

  const $ = (s, r=document) => r.querySelector(s);

  // ---- fetch helper with Bearer
  const token = () => localStorage.getItem('token') || '';
  const authHdr = () => (token() ? { Authorization: 'Bearer ' + token() } : {});
  const jfetch = async (url, opt={}) => {
    const res = await fetch(url, { ...opt, headers: { 'Content-Type':'application/json', ...authHdr(), ...(opt.headers||{}) }});
    let data=null; try{ data = await res.json(); }catch{}
    if (!res.ok) throw new Error(data?.error || String(res.status));
    return data ?? {};
  };

  // ---- tiny toast
  function toast(msg, ms=1400){
    let host = $('#toaster');
    if(!host){
      host = document.createElement('div');
      host.id = 'toaster';
      host.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'padding:8px 12px;border:1px solid #2b3a5a;border-radius:10px;background:#0f1729;color:#e9edf6;box-shadow:0 6px 22px rgba(0,0,0,.35);font-weight:600';
    host.appendChild(el);
    setTimeout(()=>el.remove(), ms);
  }

  /* ===================== Users ===================== */
  async function loadUsers(){
    const tbody = $('#userTbody') || $('#usersTbody');
    if (!tbody) return;
    const esc = s => String(s ?? '').replace(/"/g,'&quot;');

    try{
      const users = await jfetch('/api/admin/users');
      tbody.innerHTML = users.map(u=>{
        const isRoot = String(u.username).toLowerCase()==='root';
        const dis    = isRoot ? 'disabled' : '';
        return `<tr data-id="${u.id}" data-username="${u.username}">
          <td>${u.id}</td>
          <td>${u.username}</td>
          <td><input class="adm-mail input-xs input-stretch" type="email" value="${esc(u.email)}" ${isRoot?'readonly':''}></td>
          <td><input class="adm-pass input-xs input-stretch" type="text"  value="${esc(u.password)}" ${isRoot?'readonly':''}></td>
          <td>${u.role}</td>
          <td>${(u.created_at||'').replace('T',' ').replace('.000Z','')}</td>
          <td class="controls">
            <div class="btn-gap">
              <button class="btn btn-info  btn-xs adm-edit" data-uid="${u.id}" ${dis}>編集</button>
              <button class="btn btn-danger btn-xs adm-del"  data-uid="${u.id}" ${dis}>削除</button>
            </div>
          </td>
        </tr>`;
      }).join('');
    }catch(e){
      tbody.innerHTML = `<tr><td colspan="7" style="color:#ff8a8a">ユーザー取得失敗: ${e.message}</td></tr>`;
    }
  }

  // 編集/削除（※メール更新は /api/admin/users/:id の PUT、パスワードは /password）
  document.addEventListener('click', async (ev)=>{
    const edit = ev.target.closest('.adm-edit');
    const del  = ev.target.closest('.adm-del');

    if (edit){
      const tr   = edit.closest('tr');
      const id   = Number(edit.dataset.uid || tr?.dataset.id);
      const mail = tr?.querySelector('.adm-mail')?.value?.trim() ?? '';
      const pass = tr?.querySelector('.adm-pass')?.value ?? '';
      try{
        if (pass !== '') await jfetch(`/api/admin/users/${id}/password`, { method:'PUT', body: JSON.stringify({ password: pass }) });
        if (mail !== '') await jfetch(`/api/admin/users/${id}`,           { method:'PUT', body: JSON.stringify({ email: mail }) });
        toast('更新しました'); loadUsers();
      }catch(e){ alert('更新失敗: '+e.message); }
      return;
    }

    if (del){
      const id = Number(del.dataset.uid || del.closest('tr')?.dataset.id);
      if (!confirm(`ユーザー #${id} を削除しますか？`)) return;
      try{ await jfetch(`/api/admin/users/${id}`, { method:'DELETE' }); toast('削除しました'); loadUsers(); }
      catch(e){ alert('削除失敗: '+e.message); }
    }
  });

  /* =================== Backups ===================== */
  const fmtSize = b => b>=1024*1024 ? (b/1024/1024).toFixed(1)+' MB' : (b>=1024 ? (b/1024|0)+' KB' : (b||0)+' B');
  const fmtDate = ms => new Date(ms).toLocaleString();

  async function loadBackups(){
    const tbody = $('#backupTbody') || $('#bkTbody');
    if (!tbody) return;
    try{
      const list = await jfetch('/api/admin/backups');
      if (!list.length){ tbody.innerHTML=''; return; }
      tbody.innerHTML = list.map(b => `
        <tr>
          <td>${b.filename || b.name}</td>
          <td style="text-align:right">${fmtSize(b.size)} / ${fmtDate(b.mtime || b.mtimeMs || Date.now())}</td>
          <td>
            <button class="btn btn-warning btn-xs act-restore" data-fn="${encodeURIComponent(b.filename || b.name)}">リストア</button>
            <button class="btn btn-danger  btn-xs act-delbk"   data-fn="${encodeURIComponent(b.filename || b.name)}">削除</button>
          </td>
        </tr>`).join('');
    }catch(e){
      tbody.innerHTML = `<tr><td colspan="3" style="color:#ff8a8a">バックアップ一覧失敗: ${e.message}</td></tr>`;
    }
  }

  // 作成 / リストア / 削除
  document.addEventListener('click', async (ev)=>{
    const rs = ev.target.closest('.act-restore');
    const dl = ev.target.closest('.act-delbk');

    if (rs){
      const fn = decodeURIComponent(rs.dataset.fn||'');
      if (!confirm(`"${fn}" からDBをリストアします。現在の DB は上書きされます。よろしいですか？`)) return;
      try{ await jfetch('/api/admin/restore',{ method:'POST', body: JSON.stringify({ filename: fn, name: fn }) }); toast('リストアしました'); }
      catch(e){ alert('リストア失敗: '+e.message); }
      return;
    }

    if (dl){
      const fn = decodeURIComponent(dl.dataset.fn||'');
      if (!confirm(`バックアップ "${fn}" を削除しますか？`)) return;
      try{ await jfetch('/api/admin/backup/'+encodeURIComponent(fn), { method:'DELETE' }); toast('削除しました'); loadBackups(); }
      catch(e){ alert('削除失敗: '+e.message); }
    }
  });

  // boot
  document.addEventListener('DOMContentLoaded', ()=>{
    // 作成ボタン（IDはどちらでも拾う）
    (document.querySelector('#createBackupBtn') || document.querySelector('#backupMake'))
      ?.addEventListener('click', async ()=>{
        const raw = (document.querySelector('#backupName')?.value || '').trim();
        try{ await jfetch('/api/admin/backup', { method:'POST', body: JSON.stringify({ name: raw }) });
             toast('バックアップを作成しました'); loadBackups(); }
        catch(e){ alert('作成失敗: '+e.message); }
      });

    loadUsers();
    loadBackups();
  });
})();
