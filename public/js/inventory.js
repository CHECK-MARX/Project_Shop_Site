// public/js/inventory.js — 在庫管理（横並び・編集保存 / クリーン版）
(() => {
  'use strict';
  if (window.__INV_WIRED_V2__) return;
  window.__INV_WIRED_V2__ = true;

  /* ---------- 小ユーティリティ ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const token = () => (window.Auth?.getToken?.() || localStorage.getItem('token') || '').trim();

  const toInt = (v, def = 0) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : def;
  };

  function toast(msg, ms = 1300) {
    let host = $('#toaster');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toaster';
      host.style.cssText =
        'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;display:grid;gap:8px;';
      document.body.appendChild(host);
    }
    const n = document.createElement('div');
    n.textContent = msg;
    n.style.cssText =
      'padding:8px 12px;border-radius:10px;border:1px solid #2b3a5a;background:#0f1729;color:#e9edf6;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.35);font-weight:600;';
    host.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  async function api(path, opt = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(opt.headers || {}),
    };
    const res = await fetch(path, { ...opt, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  /* ---------- スタイル注入（最小限） ---------- */
  (function injectStyles() {
    if ($('#invStylesClean')) return;
    const st = document.createElement('style');
    st.id = 'invStylesClean';
    st.textContent = `
      #invTable { width:100%; min-width:980px; }
      #invTable thead th { white-space:nowrap; }
      #invTbody td { vertical-align:middle; }
      .inv-input {
        height:36px; padding:6px 10px; border-radius:10px;
        background:#0b1220; color:#e6edf7; border:1px solid #334155; outline:none;
      }
      .inv-input:focus { border-color:#60a5fa; box-shadow:0 0 0 2px rgba(96,165,250,.25); }
      .inv-name  { width:260px; }
      .inv-price { width:110px; text-align:right; }
      .inv-add   { width:80px;  text-align:right; }
      .inv-ops   { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
      .inv-grp   { display:flex; gap:8px;  align-items:center; }
      .inv-stock { font-weight:700; letter-spacing:.5px; }
      .btn { white-space:nowrap; }
    `;
    document.head.appendChild(st);
  })();

  /* ---------- DOM 準備 ---------- */
  function ensureTbody() {
    // 既存IDの順で探す。無ければ作成。
    let tbody = $('#invTbody') || $('#inventoryBody') || $('#invBody');
    if (tbody) return tbody;

    const host = $('#inventoryRoot') || $('main') || document.body;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <table id="invTable" class="table">
        <thead>
          <tr>
            <th style="width:56px;">ID</th>
            <th>商品名</th>
            <th>価格</th>
            <th>在
