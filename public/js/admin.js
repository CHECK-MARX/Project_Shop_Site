// public/js/admin.js - secure admin panel renderer
(() => {
  'use strict';
  if (window.__ADMIN_JS_LOADED__) return;
  window.__ADMIN_JS_LOADED__ = true;

  const $ = (s, r = document) => r.querySelector(s);

  const jsonFetch = async (url, options = {}) => {
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
  };

  function text(value) {
    return String(value ?? '');
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(message, ms = 1400) {
    let host = $('#toaster');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toaster';
      host.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px';
      document.body.appendChild(host);
    }

    const note = document.createElement('div');
    note.textContent = text(message);
    note.style.cssText = 'padding:8px 12px;border:1px solid #2b3a5a;border-radius:10px;background:#0f1729;color:#e9edf6;box-shadow:0 6px 22px rgba(0,0,0,.35);font-weight:600';
    host.appendChild(note);
    setTimeout(() => note.remove(), ms);
  }

  function createInput(type, className, value, readOnly = false) {
    const input = document.createElement('input');
    input.type = type;
    input.className = className;
    input.value = text(value);
    input.readOnly = !!readOnly;
    return input;
  }

  async function loadUsers() {
    const tbody = $('#userTbody') || $('#usersTbody');
    if (!tbody) return;

    try {
      const users = await jsonFetch('/api/admin/users');
      clear(tbody);

      (Array.isArray(users) ? users : []).forEach((u) => {
        const tr = document.createElement('tr');
        tr.dataset.id = String(u.id);
        tr.dataset.username = text(u.username);

        const isRoot = text(u.username).toLowerCase() === 'root';

        const idTd = document.createElement('td');
        idTd.textContent = String(u.id);

        const userTd = document.createElement('td');
        userTd.textContent = text(u.username);

        const mailTd = document.createElement('td');
        const mailInput = createInput('email', 'adm-mail input-xs input-stretch', u.email, isRoot);
        mailTd.appendChild(mailInput);

        const passTd = document.createElement('td');
        const passInput = createInput('text', 'adm-pass input-xs input-stretch', u.password, isRoot);
        passTd.appendChild(passInput);

        const roleTd = document.createElement('td');
        roleTd.textContent = text(u.role);

        const createdTd = document.createElement('td');
        createdTd.textContent = text(u.created_at || '').replace('T', ' ').replace('.000Z', '');

        const controlsTd = document.createElement('td');
        controlsTd.className = 'controls';

        const gap = document.createElement('div');
        gap.className = 'btn-gap';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-info btn-xs adm-edit';
        editBtn.dataset.uid = String(u.id);
        editBtn.type = 'button';
        editBtn.textContent = '更新';
        editBtn.disabled = isRoot;

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-xs adm-del';
        delBtn.dataset.uid = String(u.id);
        delBtn.type = 'button';
        delBtn.textContent = '削除';
        delBtn.disabled = isRoot;

        gap.appendChild(editBtn);
        gap.appendChild(delBtn);
        controlsTd.appendChild(gap);

        tr.appendChild(idTd);
        tr.appendChild(userTd);
        tr.appendChild(mailTd);
        tr.appendChild(passTd);
        tr.appendChild(roleTd);
        tr.appendChild(createdTd);
        tr.appendChild(controlsTd);
        tbody.appendChild(tr);
      });
    } catch (err) {
      clear(tbody);
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.style.color = '#ff8a8a';
      td.textContent = `ユーザー取得失敗: ${text(err.message)}`;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  const fmtSize = (bytes) => {
    const b = Number(bytes || 0);
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${Math.floor(b / 1024)} KB`;
    return `${b} B`;
  };

  const fmtDate = (ms) => new Date(ms).toLocaleString();

  async function loadBackups() {
    const tbody = $('#backupTbody') || $('#bkTbody');
    if (!tbody) return;

    try {
      const list = await jsonFetch('/api/admin/backups');
      clear(tbody);

      (Array.isArray(list) ? list : []).forEach((b) => {
        const filename = text(b.filename || b.name);
        const tr = document.createElement('tr');

        const nameTd = document.createElement('td');
        nameTd.textContent = filename;

        const metaTd = document.createElement('td');
        metaTd.style.textAlign = 'right';
        metaTd.textContent = `${fmtSize(b.size)} / ${fmtDate(b.mtime || b.mtimeMs || Date.now())}`;

        const opTd = document.createElement('td');

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn btn-warning btn-xs act-restore';
        restoreBtn.dataset.fn = encodeURIComponent(filename);
        restoreBtn.type = 'button';
        restoreBtn.textContent = 'リストア';

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-xs act-delbk';
        delBtn.dataset.fn = encodeURIComponent(filename);
        delBtn.type = 'button';
        delBtn.textContent = '削除';

        opTd.appendChild(restoreBtn);
        opTd.appendChild(document.createTextNode(' '));
        opTd.appendChild(delBtn);

        tr.appendChild(nameTd);
        tr.appendChild(metaTd);
        tr.appendChild(opTd);
        tbody.appendChild(tr);
      });
    } catch (err) {
      clear(tbody);
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.style.color = '#ff8a8a';
      td.textContent = `バックアップ一覧失敗: ${text(err.message)}`;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  document.addEventListener('click', async (event) => {
    const edit = event.target.closest('.adm-edit');
    const del = event.target.closest('.adm-del');

    if (edit) {
      const tr = edit.closest('tr');
      const id = Number(edit.dataset.uid || tr?.dataset.id);
      const email = tr?.querySelector('.adm-mail')?.value?.trim() || '';
      const password = tr?.querySelector('.adm-pass')?.value || '';

      try {
        if (password !== '') {
          await jsonFetch(`/api/admin/users/${id}/password`, {
            method: 'PUT',
            body: JSON.stringify({ password })
          });
        }
        if (email !== '') {
          await jsonFetch(`/api/admin/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ email })
          });
        }
        toast('更新しました');
        loadUsers();
      } catch (err) {
        alert(`更新失敗: ${text(err.message)}`);
      }
      return;
    }

    if (del) {
      const id = Number(del.dataset.uid || del.closest('tr')?.dataset.id);
      if (!confirm(`ユーザー #${id} を削除しますか？`)) return;

      try {
        await jsonFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
        toast('削除しました');
        loadUsers();
      } catch (err) {
        alert(`削除失敗: ${text(err.message)}`);
      }
      return;
    }

    const restore = event.target.closest('.act-restore');
    const delBackup = event.target.closest('.act-delbk');

    if (restore) {
      const filename = decodeURIComponent(restore.dataset.fn || '');
      if (!confirm(`"${filename}" からDBをリストアしますか？`)) return;

      try {
        await jsonFetch('/api/admin/restore', {
          method: 'POST',
          body: JSON.stringify({ filename, name: filename })
        });
        toast('リストアしました');
      } catch (err) {
        alert(`リストア失敗: ${text(err.message)}`);
      }
      return;
    }

    if (delBackup) {
      const filename = decodeURIComponent(delBackup.dataset.fn || '');
      if (!confirm(`バックアップ "${filename}" を削除しますか？`)) return;

      try {
        await jsonFetch(`/api/admin/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        toast('削除しました');
        loadBackups();
      } catch (err) {
        alert(`削除失敗: ${text(err.message)}`);
      }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    ($('#createBackupBtn') || $('#backupMake'))?.addEventListener('click', async () => {
      const name = text($('#backupName')?.value || '').trim();
      try {
        await jsonFetch('/api/admin/backup', {
          method: 'POST',
          body: JSON.stringify({ name })
        });
        toast('バックアップを作成しました');
        loadBackups();
      } catch (err) {
        alert(`作成失敗: ${text(err.message)}`);
      }
    });

    loadUsers();
    loadBackups();
  });
})();
