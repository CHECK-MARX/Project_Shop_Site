// server.js — 公開ベストセラーAPI / 在庫・決済 / 管理系 + プロフィールAPI（sqliteスキーマ差異に強い版）

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

// DB & Promise helpers
const db = new sqlite3.Database(path.join(__dirname, 'shopping.db'));
const dbAll = (sql, params=[]) => new Promise((res, rej)=> db.all(String(sql), params, (e, r)=> e?rej(e):res(r||[])));
const dbGet = (sql, params=[]) => new Promise((res, rej)=> db.get(String(sql), params, (e, r)=> e?rej(e):res(r||null)));
const dbRun = (sql, params=[]) => new Promise((res, rej)=> db.run(String(sql), params, function(e){ e?rej(e):res(this); }));

// ---- 初期テーブル
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
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    order_id TEXT,
    order_code TEXT,
    subtotal INTEGER,
    tax INTEGER,
    total INTEGER,
    card_last4 TEXT,
    last4 TEXT,
    payer_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    product_id INTEGER,
    name TEXT,
    price INTEGER,
    unit_price INTEGER,
    qty INTEGER,
    quantity INTEGER,
    line_total INTEGER
  )`);

  // ★ プロフィール（ユーザー1:1）
  db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER PRIMARY KEY,
    display_name TEXT,
    full_name   TEXT,
    phone       TEXT,
    birthday    TEXT,
    website     TEXT,
    country     TEXT,
    state       TEXT,
    city        TEXT,
    address1    TEXT,
    address2    TEXT,
    zip         TEXT,
    timezone    TEXT,
    bio         TEXT,
    avatar_url  TEXT,
    twitter     TEXT,
    language    TEXT,
    newsletter  INTEGER DEFAULT 0,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // デモ商品
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (1,'Laptop','High-performance laptop',3000,86,'https://picsum.photos/seed/laptop/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (2,'Smartphone','Latest smartphone model',80000,40,'https://picsum.photos/seed/phone/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (3,'Headphones','Wireless noise-cancelling headphones',200,50,'https://picsum.photos/seed/headphones/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (4,'Anime Hero','<img src=x onerror=alert(1)>',60,100,'https://picsum.photos/seed/hero/800/500')`);
});

// ---- admin/root を確保（デモ簡略）
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

// ---- utils/mw
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
app.post('/api/login', async (req,res)=>{
  const { username='', password='' } = req.body||{};
  const uname = String(username).trim(); const pass = String(password);
  if(!uname || !pass) return res.status(400).json({error:'Bad request'});
  try{
    const u = await dbGet(`SELECT * FROM users WHERE username=?`, [uname]);
    if(!u) return res.status(401).json({error:'Invalid credentials'});
    let ok = false;
    if (u.password && u.password.length > 20) { try { ok = bcrypt.compareSync(pass, u.password); } catch {} }
    else { ok = (u.password === pass); }
    if(!ok) return res.status(401).json({error:'Invalid credentials'});
    const token = sign({ userId:u.id, role:u.role });
    res.json({ token, user: { id:u.id, username:u.username, role:u.role } });
  }catch{ res.status(500).json({error:'DB error'}); }
});
app.post('/api/register', async (req,res)=>{
  const { username='', email='', password='' } = req.body||{};
  if(!username || !password) return res.status(400).json({error:'username/password required'});
  try{
    const r = await dbRun(`INSERT INTO users (username,email,password,role) VALUES (?,?,?,'user')`,
      [username.trim(), String(email||'').trim(), password]);
    res.json({ ok:true, id:r.lastID });
  }catch(e){
    if(String(e.message||'').includes('UNIQUE')) return res.status(409).json({error:'username exists'});
    res.status(500).json({error:'DB error'});
  }
});

// ---- プロフィールAPI（GET/PUT/パスワード変更）
app.get('/api/me', requireAuth, async (req,res)=>{
  try{
    const user = await dbGet(`SELECT id,username,email,role,created_at FROM users WHERE id=?`, [req.user.userId]);
    if(!user) return res.status(500).json({error:'DB error'});
    const profile = await dbGet(
      `SELECT display_name,full_name,phone,birthday,website,country,state,city,address1,address2,zip,timezone,bio,avatar_url,twitter,language,newsletter
         FROM user_profiles WHERE user_id=?`,
      [user.id]
    ) || {};
    res.json({ user, profile });
  }catch{ res.status(500).json({error:'DB error'}); }
});

app.put('/api/me', requireAuth, async (req,res)=>{
  try{
    // users.email 同期（任意入力）
    const email = (req.body && typeof req.body.email==='string') ? String(req.body.email).trim() : undefined;
    if (email !== undefined) await dbRun(`UPDATE users SET email=? WHERE id=?`, [email, req.user.userId]);

    // プロフィールの許可キーのみ受け取る
    const keys = ['display_name','full_name','phone','birthday','website','country','state','city',
                  'address1','address2','zip','timezone','bio','avatar_url','twitter','language','newsletter'];
    const data = {};
    for (const k of keys) if (k in (req.body||{})) data[k] = req.body[k];
    if ('newsletter' in data) data.newsletter = Number(data.newsletter) ? 1 : 0;

    const cols = Object.keys(data);
    if (!cols.length) return res.json({ ok:true });

    const placeholders = cols.map(()=>'?').join(',');
    const values = cols.map(k => data[k]);
    const setClause = cols.map(c => `${c}=excluded.${c}`).join(', ');

    const sql = `INSERT INTO user_profiles (user_id, ${cols.join(',')})
                 VALUES (?, ${placeholders})
                 ON CONFLICT(user_id) DO UPDATE SET ${setClause}, updated_at=CURRENT_TIMESTAMP`;
    await dbRun(sql, [req.user.userId, ...values]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'DB error' }); }
});

app.put('/api/me/password', requireAuth, async (req,res)=>{
  try{
    const { current='', next='' } = req.body || {};
    if (!current || !next) return res.status(400).json({ error:'bad_request' });

    const u = await dbGet(`SELECT id,password FROM users WHERE id=?`, [req.user.userId]);
    if(!u) return res.status(404).json({ error:'not_found' });

    let ok = false;
    if (u.password && u.password.length > 20) { try { ok = await bcrypt.compare(current, u.password); } catch {} }
    else { ok = (u.password === current); }
    if (!ok) return res.status(401).json({ error:'wrong_password' });

    // 既存仕様に合わせて平文保存（教育用）。本番なら bcrypt.hash を使うこと。
    await dbRun(`UPDATE users SET password=? WHERE id=?`, [String(next), req.user.userId]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'db' }); }
});

// ---- products
app.get('/api/products', async (req,res)=>{
  try{
    const { search } = req.query;
    let sql = `SELECT * FROM products`; const params=[];
    if(search){ sql += ` WHERE name LIKE ? OR description LIKE ?`; params.push(`%${search}%`,`%${search}%`); }
    const rows = await dbAll(sql, params);
    res.json(rows.map(r=>({...r, name:esc(r.name), description:esc(r.description)})));
  }catch{ res.status(500).json({error:'DB error'}); }
});
app.get('/api/product/:id', async (req,res)=>{
  try{
    const row = await dbGet(`SELECT * FROM products WHERE id=?`, [req.params.id]);
    if(!row)  return res.status(404).json({error:'Not found'});
    res.json({...row, name:esc(row.name), description:esc(row.description)});
  }catch{ res.status(500).json({error:'DB error'}); }
});

// ---- 管理（ユーザー）
app.get('/api/admin/users', requireAdmin, async (_req,res)=>{
  try{ const rows = await dbAll(`SELECT id,username,email,role,created_at,password FROM users ORDER BY id`);
       res.json(rows); }
  catch{ res.status(500).json({error:'DB error'}); }
});
app.put('/api/admin/users/:id/password', requireAdmin, async (req,res)=>{
  const { id } = req.params; const { password } = req.body||{};
  if(!password) return res.status(400).json({error:'password required'});
  try{ const r = await dbRun(`UPDATE users SET password=? WHERE id=?`, [password, id]);
       res.json({ ok:true, updated:r.changes }); }
  catch{ res.status(500).json({error:'DB error'}); }
});
app.delete('/api/admin/users/:id', requireAdmin, async (req,res)=>{
  try{ const r = await dbRun(`DELETE FROM users WHERE id=?`, [req.params.id]);
       res.json({ deleted:r.changes }); }
  catch{ res.status(500).json({error:'DB error'}); }
});

// ---- 在庫編集（inventory.js が使うAPI）
app.put('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

  const sets = [], args = [];
  if (typeof req.body?.name === 'string') { sets.push('name=?'); args.push(String(req.body.name).trim().slice(0,200)); }
  if (req.body?.price !== undefined) { let p = Math.round(Number(req.body.price)); if(!Number.isFinite(p) || p<0) p=0; sets.push('price=?'); args.push(p); }
  if (req.body?.stock !== undefined) { let s = Math.round(Number(req.body.stock)); if(!Number.isFinite(s) || s<0) s=0; sets.push('stock=?'); args.push(s); }
  if (!sets.length) return res.status(400).json({ error: 'no_fields' });

  try{
    await dbRun(`UPDATE products SET ${sets.join(', ')} WHERE id=?`, [...args, id]);
    const row = await dbGet(`SELECT id,name,price,stock FROM products WHERE id=?`, [id]);
    res.json({ ok:true, product: { id:row.id, name:row.name||'', price:Math.round(Number(row.price)||0), stock:Math.max(0,Number(row.stock)||0) } });
  }catch{ res.status(500).json({ error: 'DB error' }); }
});
app.post('/api/admin/products/:id/stock/add', requireAdmin, async (req,res)=>{
  const id = Number(req.params.id);
  let add = Math.round(Number(req.body?.add)); if(!Number.isFinite(add)) add = 0;
  add = Math.max(-100000, Math.min(100000, add));
  try{
    await dbRun(`UPDATE products SET stock=MAX(stock + ?, 0) WHERE id=?`, [add, id]);
    const row = await dbGet(`SELECT stock FROM products WHERE id=?`, [id]);
    res.json({ ok:true, stock: Math.max(0, Number(row.stock)||0) });
  }catch{ res.status(500).json({ error:'DB error' }); }
});

// ---- バックアップ（簡易）
app.get('/api/admin/backups', requireAdmin, async (_req,res)=>{
  try{
    const dir = path.join(__dirname, 'backups');
    await fsp.mkdir(dir, { recursive: true });
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const rows = [];
    for (const ent of entries) {
      if (!ent.isFile() || !/\.db$/i.test(ent.name)) continue;
      const st = await fsp.stat(path.join(dir, ent.name));
      rows.push({ filename: ent.name, size: st.size, mtime: st.mtimeMs });
    }
    rows.sort((a,b)=> b.mtime - a.mtime);
    res.json(rows);
  }catch(e){ console.error('[BACKUPS:list]', e); res.status(500).json([]); }
});
app.post('/api/admin/backup', requireAdmin, async (req,res)=>{
  try{
    const dir = path.join(__dirname, 'backups');
    await fsp.mkdir(dir, { recursive: true });
    const base = (req.body && String(req.body.name||'').trim()) || '';
    const safe = base.replace(/[^A-Za-z0-9_.-]/g, '');
    const name = safe ? (safe.endsWith('.db') ? safe : `${safe}.db`) : `backup_${Date.now()}.db`;
    await fsp.copyFile(path.join(__dirname,'shopping.db'), path.join(dir, name));
    res.json({ ok:true, filename:name });
  }catch(e){ console.error('[BACKUPS:create]', e); res.status(500).json({ ok:false }); }
});
app.post('/api/admin/restore', requireAdmin, async (req,res)=>{
  try{
    const raw = (req.body && req.body.filename) || (req.body && req.body.name) || '';
    const name = String(raw).replace(/[^A-Za-z0-9_.-]/g, '');
    if (!name) return res.status(400).json({ ok:false });
    await fsp.copyFile(path.join(__dirname,'backups',name), path.join(__dirname,'shopping.db'));
    res.json({ ok:true });
  }catch(e){ console.error('[BACKUPS:restore]', e); res.status(500).json({ ok:false }); }
});
app.delete('/api/admin/backup/:filename', requireAdmin, async (req,res)=>{
  try{
    const name = String(req.params.filename||'').replace(/[^A-Za-z0-9_.-]/g, '');
    await fsp.unlink(path.join(__dirname,'backups',name));
    res.json({ ok:true });
  }catch(e){ res.status(e && e.code==='ENOENT' ? 404 : 500).json({ ok:false }); }
});

// ====== 決済（在庫連動・スキーマ自動適応） ======
app.post('/api/checkout', requireAuth, async (req, res) => {
  try {
    const { items, cardLast4, name } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok:false, error:'bad_request' });

    const ids = items.map(i => Number(i.id || i.productId)).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ ok:false, error:'bad_items' });

    const qMarks = ids.map(()=>'?').join(',');
    const prods = await dbAll(`SELECT id, name, price, stock FROM products WHERE id IN (${qMarks})`, ids);

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
      if (typeof p.stock === 'number' && p.stock < qty) {
        shortage = { productId:p.id, left:p.stock, want:qty, name:p.name };
        break;
      }
    }
    if (!rows.length) return res.status(400).json({ ok:false, error:'unknown_products' });
    if (shortage) return res.status(409).json({ ok:false, error:'out_of_stock', ...shortage });

    const tax   = Math.round(subtotal * 0.1);
    const total = subtotal + tax;

    const oCols = await dbAll(`PRAGMA table_info('orders')`);
    const on = new Map(oCols.map(c => [c.name, c]));
    const has = n => on.has(n);

    const orderCode = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const last4 = String(cardLast4||'').slice(-4);

    const cols = [], vals = [];
    if (has('user_id')) cols.push('user_id'), vals.push(req.user.userId);
    if (has('order_id')) cols.push('order_id'), vals.push(orderCode);
    else if (has('order_code')) cols.push('order_code'), vals.push(orderCode);
    if (has('payer_name')) cols.push('payer_name'), vals.push(name || '');
    if (has('card_last4')) cols.push('card_last4'), vals.push(last4);
    else if (has('last4')) cols.push('last4'), vals.push(last4);
    if (has('subtotal')) cols.push('subtotal'), vals.push(subtotal);
    if (has('tax'))      cols.push('tax'),      vals.push(tax);
    if (has('total'))    cols.push('total'),    vals.push(total);
    if (!cols.length) return res.status(500).json({ ok:false, error:'orders_cols_missing' });

    const sqlOrder = `INSERT INTO orders (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;

    const txResult = await new Promise((resolve, reject)=>{
      db.serialize(()=>{
        db.run('BEGIN IMMEDIATE', err=>{
          if (err) return reject(err);
          db.run(sqlOrder, vals, function(err2){
            if (err2) return db.run('ROLLBACK', ()=> reject(err2));
            const internalId = this.lastID;

            db.all(`PRAGMA table_info('order_items')`, [], (eI, iCols)=>{
              if (eI || !iCols) return db.run('ROLLBACK', ()=> reject(new Error('items schema')));
              const imap = new Map(iCols.map(c => [c.name, c]));
              const ihas = n => imap.has(n);
              const unitCol = ihas('unit_price') ? 'unit_price' : 'price';
              const hasLine = ihas('line_total');

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
                return db.run('ROLLBACK', ()=> reject(e));
              }
              stmt.finalize(err3=>{
                if (err3) return db.run('ROLLBACK', ()=> reject(err3));

                const upd = db.prepare(`UPDATE products SET stock = stock - ? WHERE id=? AND stock >= ?`);
                let left = rows.length; let stockFail = false;

                for (const r of rows) {
                  upd.run([r.qty, r.product_id, r.qty], function(upErr){
                    if (upErr || this.changes !== 1) stockFail = true;
                    if (--left === 0) {
                      upd.finalize(()=> {
                        if (stockFail) return db.run('ROLLBACK', ()=> reject(new Error('race')));
                        db.run('COMMIT', ()=> resolve({ internalId }));
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

    // ← 常に文字の注文IDを返す（orders にコード列が無い DB でも OK）
    const returnId = (has('order_id') || has('order_code')) ? orderCode : String(txResult.internalId);

    res.json({ ok:true, orderId: returnId, subtotal, tax, total, last4 });
  } catch (e) {
    console.error('[checkout]', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// 直近の自分の注文
app.get('/api/my-orders', requireAuth, async (req, res) => {
  try{
    const cols = await dbAll(`PRAGMA table_info('orders')`);
    const names = new Set(cols.map(c => c.name));
    const base = ['id','created_at'];
    if (names.has('order_id'))   base.push('order_id');
    if (names.has('order_code')) base.push('order_code');
    if (names.has('subtotal'))   base.push('subtotal');
    if (names.has('tax'))        base.push('tax');
    if (names.has('total'))      base.push('total');
    if (names.has('card_last4')) base.push('card_last4');
    if (names.has('last4'))      base.push('last4');

    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 5)));
    const rows = await dbAll(`SELECT ${base.join(', ')} FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ?`, [req.user.userId, limit]);

    const iCols = await dbAll(`PRAGMA table_info('order_items')`);
    const inames = new Set(iCols.map(c => c.name));
    const priceCol = inames.has('unit_price') ? 'unit_price' : 'price';
    const hasLine  = inames.has('line_total');
    const idCol    = iCols.find(c => c.name === 'order_id');
    const isTextId = idCol ? /TEXT|CHAR|CLOB/i.test(String(idCol.type || '')) || String(idCol.type||'') === '' : false;

    const out = [];
    for (const r of rows) {
      let subtotal = Math.round(Number(r.subtotal)||0);
      let tax      = Math.round(Number(r.tax)||0);
      let total    = Math.round(Number(r.total)||0);

      if (!subtotal && !total) {
        const ref = isTextId ? (r.order_id ?? r.order_code ?? String(r.id)) : r.id;
        const q = hasLine
          ? `SELECT SUM(line_total) AS s FROM order_items WHERE order_id=?`
          : `SELECT SUM(${priceCol} * qty) AS s FROM order_items WHERE order_id=?`;
        const re = await dbGet(q, [ref]); const s = Math.round(Number(re && re.s)||0);
        subtotal = s; tax = Math.round(s*0.1); total = s + tax;
      }
      out.push({
        orderId: (r.order_id ?? r.order_code ?? String(r.id)),
        subtotal, tax, total,
        last4: (r.card_last4 ?? r.last4 ?? null),
        created_at: r.created_at
      });
    }
    res.json(out);
  }catch(e){ console.error(e); res.json([]); }
});

// 注文詳細（orders / order_items の列差異に対応）
app.get('/api/orders/:orderId', requireAuth, async (req, res) => {
  try{
    const param = String(req.params.orderId || '');

    const oCols = await dbAll(`PRAGMA table_info('orders')`);
    const onames = new Set(oCols.map(c => c.name));

    // どの列で探すか（order_id / order_code / id）
    let whereCol = null, whereVal = param;
    if (onames.has('order_id'))       whereCol = 'order_id';
    else if (onames.has('order_code'))whereCol = 'order_code';
    else { whereCol = 'id'; whereVal = Number(param); }

    const sel = ['id','created_at'];
    if (onames.has('order_id'))   sel.push('order_id');
    if (onames.has('order_code')) sel.push('order_code');
    if (onames.has('subtotal'))   sel.push('subtotal');
    if (onames.has('tax'))        sel.push('tax');
    if (onames.has('total'))      sel.push('total');
    if (onames.has('card_last4')) sel.push('card_last4');
    if (onames.has('last4'))      sel.push('last4');

    const head = await dbGet(
      `SELECT ${sel.join(', ')} FROM orders WHERE user_id=? AND ${whereCol}=?`,
      [req.user.userId, whereVal]
    );
    if (!head) return res.status(404).json({ error:'not_found' });

    // items 側
    const iCols = await dbAll(`PRAGMA table_info('order_items')`);
    const inames = new Set(iCols.map(c => c.name));
    const priceSel = inames.has('unit_price') ? 'unit_price AS unitPrice' : 'price AS unitPrice';

    const ref = (onames.has('order_id') || onames.has('order_code'))
      ? (head.order_id ?? head.order_code ?? String(head.id))
      : head.id;

    const items = await dbAll(
      `SELECT product_id AS productId, name, ${priceSel}, qty FROM order_items WHERE order_id=?`,
      [ref]
    );

    res.json({
      orderId   : (head.order_id ?? head.order_code ?? String(head.id)),
      subtotal  : Math.round(Number(head.subtotal||0)),
      tax       : Math.round(Number(head.tax||0)),
      total     : Math.round(Number(head.total||0)),
      last4     : (head.card_last4 ?? head.last4 ?? null),
      created_at: head.created_at,
      items     : items || []
    });
  }catch(e){
    console.error('[order detail]', e);
    res.status(500).json({ error:'db' });
  }
});

// === 管理: 売上集計（qty/quantity どちらでもOK） ===
app.get('/api/admin/sales-summary', requireAdmin, async (_req, res) => {
  const candidates = [
    `SELECT product_id, SUM(qty) AS sold FROM order_items GROUP BY product_id`,
    `SELECT product_id, SUM(quantity) AS sold FROM order_items GROUP BY product_id`,
    `SELECT product_id, SUM(qty) AS sold FROM orders_items GROUP BY product_id`,
    `SELECT product_id, SUM(quantity) AS sold FROM orders_items GROUP BY product_id`,
  ];
  try{
    let rows=null, lastErr=null;
    for (const sql of candidates) {
      try { rows = await dbAll(sql); break; } catch(e){ lastErr=e; }
    }
    if (!rows) throw lastErr || new Error('aggregation failed');
    res.json((rows||[]).map(r => ({ product_id:Number(r.product_id), sold: Math.max(0, Number(r.sold)||0) })));
  }catch(e){ console.error('sales-summary', e); res.status(500).json({ error:'db' }); }
});

// === 公開: ベストセラー Top N（未ログインOK／スキーマ差異対応） ===
app.get('/api/bestsellers', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
  const candidates = [
    `SELECT p.id, p.name, p.price, p.stock, p.image_path, SUM(oi.qty) AS sold
       FROM order_items oi JOIN products p ON p.id = oi.product_id
   GROUP BY oi.product_id ORDER BY sold DESC LIMIT ?`,
    `SELECT p.id, p.name, p.price, p.stock, p.image_path, SUM(oi.quantity) AS sold
       FROM order_items oi JOIN products p ON p.id = oi.product_id
   GROUP BY oi.product_id ORDER BY sold DESC LIMIT ?`,
    `SELECT p.id, p.name, p.price, p.stock, p.image_path, SUM(oi.qty) AS sold
       FROM orders_items oi JOIN products p ON p.id = oi.product_id
   GROUP BY oi.product_id ORDER BY sold DESC LIMIT ?`,
    `SELECT p.id, p.name, p.price, p.stock, p.image_path, SUM(oi.quantity) AS sold
       FROM orders_items oi JOIN products p ON p.id = oi.product_id
   GROUP BY oi.product_id ORDER BY sold DESC LIMIT ?`,
  ];
  try{
    let rows=null, lastErr=null;
    for (const sql of candidates) {
      try { rows = await dbAll(sql, [limit]); break; } catch(e){ lastErr=e; }
    }
    if (!rows) throw lastErr || new Error('aggregation failed');
    res.json(rows.map(r => ({
      id: Number(r.id),
      name: r.name,
      price: Number(r.price) || 0,
      stock: Number(r.stock) || 0,
      image_path: r.image_path || null,
      sold: Number(r.sold) || 0
    })));
  }catch(e){ console.error('GET /api/bestsellers error:', e); res.status(500).json({ error:'failed_to_aggregate' }); }
});

// ---- 静的
app.get('/', (_req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, ()=>{
  console.log(`Vulnerable shopping site running on port ${PORT}`);
  console.log(`[ENV] dotenv loaded: ${ENV_LOADED} | ENABLE_DEV_ROOT=${DEV_ROOT} | ADMIN_DEFAULT_EMAIL=${DEV_ROOT_EMAIL} | JWT_SECRET=${process.env.JWT_SECRET ? '(set)' : '(not set)'}`);
});
