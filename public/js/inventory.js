// public/js/inventory.js - secure inventory management UI
(() => {
  'use strict';
  if (window.__INVENTORY_WIRED__) return;
  window.__INVENTORY_WIRED__ = true;

  const $ = (s, r = document) => r.querySelector(s);

  function text(value) {
    return String(value ?? '');
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setMessage(message, isError = false) {
    const msg = $('#invMsg') || $('#authMsg');
    if (!msg) return;
    msg.style.display = message ? '' : 'none';
    msg.style.color = isError ? '#ff6b6b' : '#69f0ae';
    msg.textContent = text(message);
  }

  async function fetchMe() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function ensureAdmin() {
    const me = await fetchMe();
    if (!me || !me.user) {
      setMessage('ログインしてください。', true);
      return false;
    }
    if (me.user.role !== 'admin') {
      setMessage('このページは管理者専用です。', true);
      return false;
    }
    setMessage('');
    return true;
  }

  async function apiAuthGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function apiAuthJSON(url, method, body) {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  function makeButton(label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function makeInput(value, className, type = 'text') {
    const input = document.createElement('input');
    input.type = type;
    input.className = className;
    input.value = text(value);
    return input;
  }

  async function loadAll() {
    const tbody = $('#invBody');
    if (!tbody) return;

    const adminOk = await ensureAdmin();
    if (!adminOk) {
      clear(tbody);
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 99;
      td.style.padding = '16px';
      td.textContent = '管理者としてログインしてください。';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    let products = [];
    let soldMap = new Map();

    try {
      const [p, sales] = await Promise.all([
        fetch('/api/products', { credentials: 'include' }).then((r) => r.ok ? r.json() : []),
        apiAuthGet('/api/admin/sales-summary').catch(() => [])
      ]);

      products = Array.isArray(p) ? p : [];
      if (Array.isArray(sales)) {
        sales.forEach((s) => {
          soldMap.set(Number(s.product_id), Math.max(0, Number(s.sold) || 0));
        });
      }
    } catch (_) {
      setMessage('在庫情報の読み込みに失敗しました。', true);
      products = [];
      soldMap = new Map();
    }

    clear(tbody);

    if (products.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 99;
      td.style.padding = '16px';
      td.textContent = '商品がありません。';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const p of products) {
      const id = Number(p.id || 0);
      const name = text(p.name || '');
      const price = Math.round(Number(p.price || 0));
      const stock = Math.max(0, Number(p.stock || 0));
      const sold = soldMap.get(id) || 0;

      const tr = document.createElement('tr');
      tr.dataset.id = String(id);

      const idTd = document.createElement('td');
      idTd.textContent = String(id);

      const nameTd = document.createElement('td');
      const nameInput = makeInput(name, 'num-in name-in');
      nameInput.dataset.k = 'name';
      nameTd.appendChild(nameInput);

      const priceTd = document.createElement('td');
      const priceInput = makeInput(price, 'num-in price-in', 'number');
      priceInput.step = '1';
      priceInput.dataset.k = 'price';
      priceTd.appendChild(priceInput);

      const stockTd = document.createElement('td');
      stockTd.className = 'stock';
      stockTd.textContent = String(stock);

      const controlTd = document.createElement('td');
      controlTd.className = 'ctrls';

      const btnRow = document.createElement('div');
      btnRow.className = 'btn-row';

      const addInput = makeInput(0, 'num-in add-in', 'number');
      addInput.placeholder = '0';

      const soldWrap = document.createElement('div');
      soldWrap.className = 'sold-wrap';
      soldWrap.textContent = `売れた: ${sold.toLocaleString('ja-JP')}`;

      const addBy = (n) => {
        addInput.value = String((Number(addInput.value) || 0) + n);
      };

      btnRow.appendChild(makeButton('+1', 'mini add-1', () => addBy(1)));
      btnRow.appendChild(makeButton('+5', 'mini add-5', () => addBy(5)));
      btnRow.appendChild(makeButton('+10', 'mini add-10', () => addBy(10)));

      const saveBtn = makeButton('保存', 'btn save', async () => {
        const payload = {};
        const newName = text(nameInput.value).trim();
        const newPrice = Math.round(Number(priceInput.value) || 0);

        if (newName) payload.name = newName;
        if (Number.isFinite(newPrice)) payload.price = newPrice;

        if (!Object.keys(payload).length) {
          setMessage('変更がありません。', true);
          return;
        }

        try {
          await apiAuthJSON(`/api/admin/products/${id}`, 'PUT', payload);
          setMessage('保存しました。');
          await loadAll();
        } catch (_) {
          setMessage('保存に失敗しました。', true);
        }
      });

      const stockInputTd = document.createElement('td');
      stockInputTd.appendChild(addInput);

      const stockBtnTd = document.createElement('td');
      const applyBtn = makeButton('追加', 'btn do-add', async () => {
        const add = Math.round(Number(addInput.value));
        if (!Number.isFinite(add) || add === 0) {
          setMessage('追加数を入力してください。', true);
          return;
        }

        try {
          const data = await apiAuthJSON(`/api/admin/products/${id}/stock/add`, 'POST', { add });
          stockTd.textContent = String(Math.max(0, Number(data.stock) || 0));
          addInput.value = '0';
          setMessage('在庫を更新しました。');
        } catch (_) {
          setMessage('在庫更新に失敗しました。', true);
        }
      });

      controlTd.appendChild(btnRow);
      controlTd.appendChild(soldWrap);
      controlTd.appendChild(saveBtn);
      stockBtnTd.appendChild(applyBtn);

      tr.appendChild(idTd);
      tr.appendChild(nameTd);
      tr.appendChild(priceTd);
      tr.appendChild(stockTd);
      tr.appendChild(controlTd);
      tr.appendChild(stockInputTd);
      tr.appendChild(stockBtnTd);
      tbody.appendChild(tr);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#btnSalesHistory')?.addEventListener('click', () => {
      location.href = './sales-history.html';
    });
    loadAll();
  });
})();
