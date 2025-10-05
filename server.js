// server.js — admin/root ブートストラップ、JWT、商品API、管理API、バックアップAPI、決済（在庫連動 & スキーマ自動適応）

let ENV_LOADED = false;
try { require('dotenv').config(); ENV_LOADED = true; } catch {}

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const fsp     = fs.promises;

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_KEY = process.env.JWT_SECRET || 'weak-jwt-secret';
const DEV_ROOT = String(process.env.ENABLE_DEV_ROOT || '').toLowerCase() === 'true';
const DEV_ROOT_EMAIL = process.env.ADMIN_DEFAULT_EMAIL || 'root@local';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'shopping.db'));

// ---- 起動時テーブル（既存があればそのまま）
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    password TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    price REAL,
    image_path TEXT,
    stock INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // もっとも新しい素朴な形（存在しなければ作成）。既存があればそのまま使う。
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    order_id TEXT UNIQUE,
    subtotal INTEGER,
    tax INTEGER,
    total INTEGER,
    last4 TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    product_id INTEGER,
    name TEXT,
    price INTEGER,
    qty INTEGER
  )`);

  // デモ商品
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (1,'Laptop','High-performance laptop',999,10,'https://picsum.photos/seed/laptop/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (2,'Smartphone','Latest smartphone model',700,25,'https://picsum.photos/seed/phone/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (3,'Headphones','Wireless noise-cancelling headphones',200,50,'https://picsum.photos/seed/headphones/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (4,'Anime Hero','<img src=x onerror=alert(1)>',60,100,'https://picsum.photos/seed/hero/800/500')`);
});

// ---- admin/root を必ず確保（デモ）
function ensureAdminBootstrap() {
  db.run(`INSERT OR IGNORE INTO users (username,email,password,role)
          VALUES ('admin','admin@shop.com','admin123','admin')`);
  db.run(`UPDATE users SET role='admin' WHERE username='admin' AND role <> 'admin'`);
  db.run(`UPDATE users SET password='admin123' WHERE username='admin'`);

  if (DEV_ROOT) {
    db.run(`INSERT OR IGNORE INTO users (username,email,password,role)
            VALUES ('root', ?, 'root', 'admin')`, [DEV_ROOT_EMAIL]);
    db.run(`UPDATE users SET role='admin', email=? WHERE username='root'`, [DEV_ROOT_EMAIL]);
    db.run(`UPDATE users SET password='root' WHERE username='root'`);
    console.log('[BOOT] DEV_ROOT=true により root/root (admin) を確保しました');
  }
}
ensureAdminBootstrap();

// ---- 共通ユーティリティ
const esc = s => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const sign = p => jwt.sign(p, JWT_KEY, { expiresIn: '24h' });

function requireAuth(req,res,next){
  const t = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!t) return res.status(401).json({error:'No token'});
  try { req.user = jwt.verify(t, JWT_KEY); next(); }
  catch { return res.status(401).json({error:'Invalid token'}); }
}
function requireAdmin(req,res,next){
  requireAuth(req,res,()=> (req.user?.role==='admin') ? next() : res.status(403).json({error:'forbidden'}));
}

// ---- 認証
app.post('/api/login', (req,res)=>{
  const { username='', password='' } = req.body||{};
  const uname = String(username).trim();
  const pass  = String(password);
  if(!uname || !pass) return res.status(400).json({error:'Bad request'});

  db.get(`SELECT * FROM users WHERE username=?`, [uname], (err,u)=>{
    if(err) return res.status(500).json({error:'DB error'});
    if(!u)  return res.status(401).json({error:'Invalid credentials'});

    let ok = false;
    if (u.password && u.password.length > 20) { try { ok = bcrypt.compareSync(pass, u.password); } catch {} }
    else { ok = (u.password === pass); }
    if(!ok) return res.status(401).json({error:'Invalid credentials'});

    const token = sign({ userId:u.id, role:u.role });
    res.json({ token, user: { id:u.id, username:u.username, role:u.role } });
  });
});

app.post('/api/register', (req,res)=>{
  const { username='', email='', password='' } = req.body||{};
  if(!username || !password) return res.status(400).json({error:'username/password required'});
  db.run(`INSERT INTO users (username,email,password,role) VALUES (?,?,?,'user')`,
    [username.trim(), email.trim(), password], function(err){
      if(err){
        if(String(err.message||'').includes('UNIQUE')) return res.status(409).json({error:'username exists'});
        return res.status(500).json({error:'DB error'});
      }
      res.json({ ok:true, id:this.lastID });
    });
});

// ---- 自分情報
app.get('/api/me', requireAuth, (req,res)=>{
  db.get(`SELECT id,username,email,role,created_at FROM users WHERE id=?`,
    [req.user.userId],
    (e,row)=> e||!row ? res.status(500).json({error:'DB error'}) : res.json({ token:req.user, user:row })
  );
});

// ---- products
app.get('/api/products', (req,res)=>{
  const { search } = req.query;
  let sql = `SELECT * FROM products`; const params=[];
  if(search){ sql += ` WHERE name LIKE ? OR description LIKE ?`; params.push(`%${search}%`,`%${search}%`); }
  db.all(sql, params, (err,rows)=>{
    if(err) return res.status(500).json({error:'DB error'});
    res.json(rows.map(r=>({...r, name:esc(r.name), description:esc(r.description)})));
  });
});
app.get('/api/product/:id', (req,res)=>{
  db.get(`SELECT * FROM products WHERE id=?`, [req.params.id], (err,row)=>{
    if(err) return res.status(500).json({error:'DB error'});
    if(!row)  return res.status(404).json({error:'Not found'});
    res.json({...row, name:esc(row.name), description:esc(row.description)});
  });
});

// ---- admin users
app.get('/api/admin/users', requireAdmin, (_req,res)=>{
  db.all(`SELECT id,username,email,role,created_at,password FROM users ORDER BY id`, (err,rows)=>{
    if(err) return res.status(500).json({error:'DB error'});
    res.json(rows);
  });
});
app.put('/api/admin/users/:id/password', requireAdmin, (req,res)=>{
  const { id } = req.params; const { password } = req.body||{};
  if(!password) return res.status(400).json({error:'password required'});
  db.run(`UPDATE users SET password=? WHERE id=?`, [password, id], function(err){
    if(err) return res.status(500).json({error:'DB error'});
    res.json({ ok:true, updated:this.changes });
  });
});
app.delete('/api/admin/users/:id', requireAdmin, (req,res)=>{
  db.run(`DELETE FROM users WHERE id=?`, [req.params.id], function(err){
    if(err) return res.status(500).json({error:'DB error'});
    res.json({ deleted:this.changes });
  });
});
/* ===== Inventory (admin) ===== */

// 一覧
app.get('/api/admin/inventory', requireAdmin, (_req, res) => {
  db.all(`SELECT id, name, price, stock FROM products ORDER BY id`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    // number 正規化
    res.json((rows||[]).map(r => ({
      id: r.id,
      name: r.name || '',
      price: Math.round(Number(r.price) || 0),
      stock: Math.max(0, Number(r.stock) || 0)
    })));
  });
});

// 商品の「名前」「価格」（必要に応じて stock の絶対値）を更新
app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

  // name/price/stock のうち来たものだけ更新
  const sets = [], args = [];
  if (typeof req.body?.name === 'string') {
    const name = String(req.body.name).trim().slice(0, 200);
    sets.push('name=?'); args.push(name);
  }
  if (req.body?.price !== undefined) {
    let p = Math.round(Number(req.body.price));
    if (!Number.isFinite(p) || p < 0) p = 0;
    sets.push('price=?'); args.push(p);
  }
  if (req.body?.stock !== undefined) { // 絶対値で入れたい場合
    let s = Math.round(Number(req.body.stock));
    if (!Number.isFinite(s) || s < 0) s = 0;
    sets.push('stock=?'); args.push(s);
  }
  if (!sets.length) return res.status(400).json({ error: 'no_fields' });

  args.push(id);
  db.run(`UPDATE products SET ${sets.join(', ')} WHERE id=?`, args, function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    db.get(`SELECT id,name,price,stock FROM products WHERE id=?`, [id], (e, row) => {
      if (e || !row) return res.status(500).json({ error: 'DB error' });
      res.json({
        ok: true,
        product: {
          id: row.id,
          name: row.name || '',
          price: Math.round(Number(row.price) || 0),
          stock: Math.max(0, Number(row.stock) || 0)
        }
      });
    });
  });
});

// 在庫を「加算」する（既存の＋ボタン用）
app.post('/api/admin/products/:id/stock/add', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  let add = Math.round(Number(req.body?.add));
  if (!Number.isFinite(add)) add = 0;
  // 過度な加算を抑制（任意で調整）
  add = Math.max(-100000, Math.min(100000, add));

  db.run(`UPDATE products SET stock=MAX(stock + ?, 0) WHERE id=?`, [add, id], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    db.get(`SELECT stock FROM products WHERE id=?`, [id], (e, row) => {
      if (e || !row) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true, stock: Math.max(0, Number(row.stock)||0) });
    });
  });
});

// ---- 軽量更新
function updateEmailRole(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

  const email = (req.body && typeof req.body.email === 'string') ? String(req.body.email).trim() : undefined;
  const role  = (req.body && typeof req.body.role  === 'string') ? String(req.body.role ).trim() : undefined;

  db.get('SELECT username FROM users WHERE id=?', [id], (e, row) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (String(row.username).toLowerCase() === 'root') {
      return res.status(400).json({ error: 'root cannot be changed' });
    }

    const sets = []; const args = [];
    if (email !== undefined) { sets.push('email=?'); args.push(email); }
    if (role  !== undefined && (role === 'admin' || role === 'user')) { sets.push('role=?'); args.push(role); }
    if (!sets.length) return res.json({ updated: 0 });

    args.push(id);
    db.run(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, args, function (e2) {
      if (e2) return res.status(500).json({ error: 'Database error' });
      return res.json({ updated: this.changes });
    });
  });
}
app.put('/api/admin/users/:id',       requireAdmin, updateEmailRole);
app.put('/api/admin/users/:id/email', requireAdmin, updateEmailRole);

// ===== バックアップ API =====
app.get('/api/admin/backups', requireAdmin, async (_req, res) => {
  try {
    const dir = path.join(__dirname, 'backups');
    await fsp.mkdir(dir, { recursive: true });
    const entries = await fsp.readdir(dir, { withFileTypes: true });

    const rows = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!/\.db$/i.test(ent.name)) continue;
      const full = path.join(dir, ent.name);
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      const dt = new Date(st.mtime);
      const created =
        `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ` +
        `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;
      rows.push({ name: ent.name, size: st.size, created_at: created });
    }
    rows.sort((a,b) => b.created_at.localeCompare(a.created_at));
    res.json(rows);
  } catch (e) {
    console.error('[ADMIN_BACKUPS:list]', e);
    res.status(500).json({ error:'list_failed', message:String(e && e.message || e) });
  }
});
app.post('/api/backup', requireAdmin, async (req, res) => {
  try {
    const dir = path.join(__dirname, 'backups');
    await fsp.mkdir(dir, { recursive: true });
    const base = (req.body && String(req.body.backupName||'').trim()) || '';
    const safe = base.replace(/[^A-Za-z0-9_.-]/g, '');
    const name = safe ? (safe.endsWith('.db') ? safe : `${safe}.db`)
                      : `backup_${Date.now()}.db`;
    await fsp.copyFile(path.join(__dirname,'shopping.db'), path.join(dir, name));
    res.json({ ok:true, name });
  } catch (e) {
    console.error('[ADMIN_BACKUPS:create]', e);
    res.status(500).json({ error:'create_failed', message:String(e && e.message || e) });
  }
});
app.post('/api/admin/restore', requireAdmin, async (req, res) => {
  try {
    const raw = (req.body && req.body.name) || '';
    const name = String(raw).replace(/[^A-Za-z0-9_.-]/g, '');
    if (!name || !name.endsWith('.db')) return res.status(400).json({ error: 'bad_name' });

    const src = path.join(__dirname, 'backups', name);
    const dst = path.join(__dirname, 'shopping.db');
    await fsp.copyFile(src, dst);
    res.json({ ok: true, restored: name });
  } catch (e) {
    console.error('[ADMIN_BACKUPS:restore]', e);
    res.status(500).json({ error:'restore_failed', message:String(e && e.message || e) });
  }
});
app.delete('/api/admin/backups/:name', requireAdmin, async (req, res) => {
  try {
    const raw = req.params.name || '';
    const name = String(raw).replace(/[^A-Za-z0-9_.-]/g, '');
    const p = path.join(__dirname, 'backups', name);
    await fsp.unlink(p);
    res.json({ ok: true, deleted: name });
  } catch (e) {
    const code = e && e.code === 'ENOENT' ? 404 : 500;
    console.error('[ADMIN_BACKUPS:delete]', e);
    res.status(code).json({ error:'delete_failed', message:String(e && e.message || e) });
  }
});

// ====== 決済（在庫連動 & 完全スキーマ自動適応） ======
app.post('/api/checkout', requireAuth, (req, res) => {
  try {
    const { items, cardLast4, name } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok:false, error:'bad_request' });
    }

    // 価格はサーバ側 products を正とする
    const ids = items.map(i => Number(i.id || i.productId)).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ ok:false, error:'bad_items' });

    const qMarks = ids.map(()=>'?').join(',');
    db.all(`SELECT id, name, price, stock FROM products WHERE id IN (${qMarks})`, ids, (e, prods) => {
      if (e) return res.status(500).json({ ok:false, error:'db' });

      let subtotal = 0;
      const rows = [];
      let shortage = null;

      for (const it of items) {
        const pid = Number(it.id || it.productId);
        const p = prods.find(pr => pr.id === pid);
        if (!p) continue;
        const qty = Math.max(1, Number(it.qty||1));
        const unit = Math.round(Number(p.price)||0);
        subtotal += unit * qty;
        rows.push({ product_id:p.id, name:p.name, price:unit, qty, stock:p.stock });

        // 在庫チェック（在庫が定義されている場合）
        if (typeof p.stock === 'number' && p.stock < qty) {
          shortage = { productId:p.id, left:p.stock, want:qty, name:p.name };
          break;
        }
      }
      if (!rows.length) return res.status(400).json({ ok:false, error:'unknown_products' });
      if (shortage) return res.status(409).json({ ok:false, error:'out_of_stock', ...shortage });

      const tax   = Math.round(subtotal * 0.1);
      const total = subtotal + tax;

      // --- orders/order_items の列を検出
      db.all(`PRAGMA table_info('orders')`, [], (eO, oCols) => {
        if (eO || !oCols) return res.status(500).json({ ok:false, error:'db_schema' });
        const on = new Map(oCols.map(c => [c.name, c])); // name -> col
        const has = n => on.has(n);

        const orderCode = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        const last4 = String(cardLast4||'').slice(-4);

        // 挿入する列を「存在するものだけ」で組み立て
        const cols = [], vals = [];
        if (has('user_id')) cols.push('user_id'), vals.push(req.user.userId);
        if (has('order_id')) cols.push('order_id'), vals.push(orderCode);
        else if (has('order_code')) cols.push('order_code'), vals.push(orderCode);
        if (has('payer_name')) cols.push('payer_name'), vals.push(name || '');
        if (has('card_last4')) cols.push('card_last4'), vals.push(last4);
        else if (has('last4')) cols.push('last4'), vals.push(last4);
        if (has('subtotal')) cols.push('subtotal'), vals.push(subtotal);
        if (has('tax')) cols.push('tax'), vals.push(tax);
        if (has('total')) cols.push('total'), vals.push(total);
        if (!cols.length) return res.status(500).json({ ok:false, error:'orders_cols_missing' });

        const sql = `INSERT INTO orders (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;

        // トランザクションで注文・明細・在庫更新を一括
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE', (begErr) => {
            if (begErr) return res.status(500).json({ ok:false, error:'tx_begin' });

            db.run(sql, vals, function(err){
              if (err) {
                return db.run('ROLLBACK', ()=> res.status(500).json({ ok:false, error:'db_insert' }));
              }
              const internalId = this.lastID;

              // order_items の列検出
              db.all(`PRAGMA table_info('order_items')`, [], (eI, iCols) => {
                if (eI || !iCols) {
                  return db.run('ROLLBACK', ()=> res.status(500).json({ ok:false, error:'db_schema_items' }));
                }
                const imap = new Map(iCols.map(c => [c.name, c]));
                const ihas = n => imap.has(n);

                const unitCol = ihas('unit_price') ? 'unit_price' : 'price';
                const hasLine = ihas('line_total');

                // items 側の order_id が TEXT 的ならコード、INT 的なら内部ID
                let orderRef = internalId;
                const oIdCol = iCols.find(c => c.name === 'order_id');
                if (oIdCol) {
                  const t = String(oIdCol.type||'').toUpperCase();
                  const looksText = t.includes('TEXT') || t.includes('CHAR') || t.includes('CLOB') || t === '' ;
                  if (looksText && (has('order_id') || has('order_code'))) {
                    orderRef = (has('order_id') || has('order_code')) ? orderCode : String(internalId);
                  }
                }

                const sqlItems = `INSERT INTO order_items (order_id, product_id, name, ${unitCol}, qty${hasLine?', line_total':''})
                                  VALUES (?,?,?,?,?${hasLine?', ?':''})`;
                const stmt = db.prepare(sqlItems);

                try {
                  for (const r of rows) {
                    const ps = [orderRef, r.product_id, r.name, r.price, r.qty];
                    if (hasLine) ps.push(r.price * r.qty);
                    stmt.run(ps);
                  }
                } catch(e) {
                  return db.run('ROLLBACK', ()=> res.status(500).json({ ok:false, error:'db_items' }));
                }

                stmt.finalize(err2 => {
                  if (err2) {
                    return db.run('ROLLBACK', ()=> res.status(500).json({ ok:false, error:'db_items' }));
                  }

                  // 在庫更新（在庫 >= 購入数 を保証）
                  const upd = db.prepare(`UPDATE products SET stock = stock - ? WHERE id=? AND stock >= ?`);
                  let left = rows.length;
                  let stockFail = false;

                  for (const r of rows) {
                    upd.run([r.qty, r.product_id, r.qty], function(upErr){
                      if (upErr || this.changes !== 1) stockFail = true;
                      if (--left === 0) {
                        upd.finalize(()=> {
                          if (stockFail) {
                            return db.run('ROLLBACK', ()=> res.status(409).json({ ok:false, error:'out_of_stock_after', note:'race' }));
                          }
                          db.run('COMMIT', ()=> {
                            const returnId = (has('order_id') || has('order_code')) ? orderCode : String(internalId);
                            return res.json({ ok:true, orderId: returnId, subtotal, tax, total, last4 });
                          });
                        });
                      }
                    });
                  }
                });
              });
            });
          });
        });
      });
    });
  } catch (e) {
    console.error('[checkout]', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

// 直近の自分の注文（存在列だけでSELECTし、必要なら order_items から再計算）
app.get('/api/my-orders', requireAuth, (req, res) => {
  db.all(`PRAGMA table_info('orders')`, [], (e, cols) => {
    if (e || !cols) return res.status(500).json([]);
    const names = new Set(cols.map(c => c.name));

    // ある列だけをSELECT
    const base = ['id', 'created_at'];
    if (names.has('order_id'))   base.push('order_id');
    if (names.has('order_code')) base.push('order_code');
    if (names.has('subtotal'))   base.push('subtotal');
    if (names.has('tax'))        base.push('tax');
    if (names.has('total'))      base.push('total');
    if (names.has('card_last4')) base.push('card_last4');
    if (names.has('last4'))      base.push('last4');

    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 5)));
    const sql = `SELECT ${base.join(', ')} FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ?`;

    db.all(sql, [req.user.userId, limit], (err, rows) => {
      if (err) return res.status(500).json([]);

      // order_items の列を一度だけ検出（unit_price/price, line_total, order_id の型）
      db.all(`PRAGMA table_info('order_items')`, [], (e2, iCols) => {
        const inames = new Set((iCols || []).map(c => c.name));
        const priceCol = inames.has('unit_price') ? 'unit_price' : 'price';
        const hasLine  = inames.has('line_total');
        const idCol    = (iCols || []).find(c => c.name === 'order_id');
        const isTextId = idCol ? /TEXT|CHAR|CLOB/i.test(String(idCol.type || '')) || String(idCol.type||'') === '' : false;

        const num = v => Math.round(Number(v) || 0);

        const result = [];
        let i = 0;

        const next = () => {
          if (i >= (rows || []).length) {
            // 互換キーも入れて返す（frontend互換）
            return res.json(result.map(r => ({
              orderId   : (r.order_id ?? r.order_code ?? String(r.id)),
              subtotal  : r.subtotal,
              tax       : r.tax,
              total     : r.total,
              charged   : r.total,       // 互換
              subTotal  : r.subtotal,    // 互換
              last4     : (r.card_last4 ?? r.last4 ?? null),
              created_at: r.created_at
            })));
          }

          const r = rows[i++];

          let subtotal = num(r.subtotal);
          let tax      = num(r.tax);
          let total    = num(r.total);

          // 値が無い/0なら order_items から再計算
          if (!subtotal && !total) {
            const ref = isTextId ? (r.order_id ?? r.order_code ?? String(r.id)) : r.id;
            const q   = hasLine
              ? `SELECT SUM(line_total) AS s FROM order_items WHERE order_id=?`
              : `SELECT SUM(${priceCol} * qty) AS s FROM order_items WHERE order_id=?`;

            db.get(q, [ref], (e3, row) => {
              const s = num(row && row.s);
              subtotal = s;
              tax      = tax || Math.round(s * 0.1);
              total    = s + tax;
              result.push({ ...r, subtotal, tax, total });
              next();
            });
          } else {
            result.push({ ...r, subtotal, tax, total });
            next();
          }
        };

        next();
      });
    });
  });
});

// 注文詳細（存在列だけでSELECT）
app.get('/api/orders/:orderId', requireAuth, (req, res) => {
  const param = String(req.params.orderId||'');
  db.all(`PRAGMA table_info('orders')`, [], (e, cols) => {
    if (e || !cols) return res.status(500).json({ error:'db' });
    const names = new Set(cols.map(c => c.name));

    // どの列で探すか
    let whereCol = null; let whereVal = param;
    if (names.has('order_id')) whereCol = 'order_id';
    else if (names.has('order_code')) whereCol = 'order_code';
    else whereCol = 'id', whereVal = Number(param); // コード列が無い場合は id を使う

    const sel = ['id','created_at'];
    if (names.has('order_id')) sel.push('order_id');
    if (names.has('order_code')) sel.push('order_code');
    if (names.has('subtotal')) sel.push('subtotal');
    if (names.has('tax')) sel.push('tax');
    if (names.has('total')) sel.push('total');
    if (names.has('card_last4')) sel.push('card_last4');
    if (names.has('last4')) sel.push('last4');

    const sql = `SELECT ${sel.join(', ')} FROM orders WHERE user_id=? AND ${whereCol}=?`;
    db.get(sql, [req.user.userId, whereVal], (err, head) => {
      if (err || !head) return res.status(404).json({ error:'not_found' });

      db.all(`PRAGMA table_info('order_items')`, [], (e2, iCols) => {
        if (e2 || !iCols) return res.status(500).json({ error:'db' });
        const inames = new Set(iCols.map(c => c.name));
        const priceSel = inames.has('unit_price') ? 'unit_price AS unitPrice' : 'price AS unitPrice';

        // items 側の order_id は、orders にコード列があるならコード、無いなら内部 id
        const ref = (names.has('order_id') || names.has('order_code'))
          ? (head.order_id ?? head.order_code ?? String(head.id))
          : head.id;

        const sqlItems = `SELECT product_id AS productId, name, ${priceSel}, qty FROM order_items WHERE order_id=?`;
        db.all(sqlItems, [ref], (e3, items) => {
          if (e3) return res.status(500).json({ error:'db' });
          res.json({
            orderId: (head.order_id ?? head.order_code ?? String(head.id)),
            subtotal: head.subtotal ?? 0,
            tax: head.tax ?? 0,
            total: head.total ?? 0,
            last4: (head.card_last4 ?? head.last4 ?? null),
            created_at: head.created_at,
            items: items || []
          });
        });
      });
    });
  });
});

// ===== 在庫管理 API（管理者専用） =====
app.get('/api/admin/inventory', requireAdmin, (_req, res) => {
  db.all(`SELECT id, name, price, stock, created_at FROM products ORDER BY id`, [], (e, rows) => {
    if (e) return res.status(500).json({ error:'DB error' });
    res.json(rows || []);
  });
});

// op: 'add'（増やす） or 'set'（絶対値）; amount: 数量
app.put('/api/admin/inventory/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { op='add', amount } = req.body || {};
  const n = Math.round(Number(amount));
  if (!Number.isInteger(id) || !(op==='add' || op==='set') || !Number.isFinite(n)) {
    return res.status(400).json({ error:'bad_request' });
  }
  if (op === 'set') {
    const target = Math.max(0, n);
    db.run(`UPDATE products SET stock=? WHERE id=?`, [target, id], function(err){
      if (err) return res.status(500).json({ error:'DB error' });
      db.get(`SELECT id, name, price, stock FROM products WHERE id=?`, [id], (e,row)=> {
        if (e || !row) return res.status(500).json({ error:'DB error' });
        res.json({ ok:true, product: row });
      });
    });
  } else {
    // add
    db.run(`UPDATE products SET stock = MAX(0, stock + ?) WHERE id=?`, [n, id], function(err){
      if (err) return res.status(500).json({ error:'DB error' });
      db.get(`SELECT id, name, price, stock FROM products WHERE id=?`, [id], (e,row)=> {
        if (e || !row) return res.status(500).json({ error:'DB error' });
        res.json({ ok:true, product: row });
      });
    });
  }
});

// ---- 静的
app.get('/', (_req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, ()=>{
  console.log(`Vulnerable shopping site running on port ${PORT}`);
  console.log(`[ENV] dotenv loaded: ${ENV_LOADED} | ENABLE_DEV_ROOT=${DEV_ROOT} | ADMIN_DEFAULT_EMAIL=${DEV_ROOT_EMAIL} | JWT_SECRET=${process.env.JWT_SECRET ? '(set)' : '(not set)'}`);
});
