// server.js — 公開ベストセラーAPI / 在庫・決済 / 管理系 + プロフィールAPI（sqliteスキーマ差異に強い版）
// バックアップは VACUUM INTO → copy → stream の多段フォールバック、
// リストアは close→置換→再オープン。削除ユーザー名の履歴スナップショット & 再登録フラグ対応。

/* ─────────────────────────
   0) 起動・例外ログを強化
───────────────────────── */
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

let ENV_LOADED = false;
try { require('dotenv').config(); ENV_LOADED = true; } catch {}

/* ─────────────────────────
   1) 依存・基本設定
───────────────────────── */
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const fsp     = fs.promises;

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const JWT_KEY = process.env.JWT_SECRET || 'weak-jwt-secret';
const DEV_ROOT = String(process.env.ENABLE_DEV_ROOT || '').toLowerCase() === 'true';
const DEV_ROOT_EMAIL = process.env.ADMIN_DEFAULT_EMAIL || 'root@local';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静的ファイル（/public）
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────────────────
   2) DB & Promise helpers
───────────────────────── */
let db = new sqlite3.Database(path.join(__dirname, 'shopping.db'));

const dbAll = (sql, params=[]) => new Promise((res, rej)=> db.all(String(sql), params, (e, r)=> e?rej(e):res(r||[])));
const dbGet = (sql, params=[]) => new Promise((res, rej)=> db.get(String(sql), params, (e, r)=> e?rej(e):res(r||null)));
const dbRun = (sql, params=[]) => new Promise((res, rej)=> db.run(String(sql), params, function(e){ e?rej(e):res(this); }));

/* ─────────────────────────
   3) 初期テーブル作成
───────────────────────── */
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
    buyer_username TEXT, -- 履歴表示用のスナップショット
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
  // 退会ユーザー記録（再登録検知・履歴補助）
  db.run(`CREATE TABLE IF NOT EXISTS deleted_users (
    user_id    INTEGER,
    username   TEXT,
    email      TEXT,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

/* ─────────────────────────
   3.5) スキーマ自己修復（古いバックアップ対策）
───────────────────────── */
async function ensureOrdersSchema(){
  try{
    const cols = await dbAll(`PRAGMA table_info('orders')`);
    const names = new Set(cols.map(c=>c.name));
    if (!names.has('buyer_username')) {
      console.log('[SCHEMA] add orders.buyer_username');
      await dbRun(`ALTER TABLE orders ADD COLUMN buyer_username TEXT`);
    }
  }catch(e){
    console.warn('[SCHEMA] ensureOrdersSchema warn:', e?.message||e);
  }
}

/* ─────────────────────────
   4) admin/root を確保 & 起動時バックフィル
───────────────────────── */
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

// 起動時バックフィル：buyer_username が空の注文へスナップショットを埋める（列がある時だけ）
async function ensureBuyerUsernameSnapshot(){
  try{
    const cols = await dbAll(`PRAGMA table_info('orders')`);
    const names = new Set(cols.map(c=>c.name));
    if (!names.has('buyer_username')) return; // 列がない場合は何もしない（ensureOrdersSchema 後にもう一度呼ばれる）

    await dbRun(`
      UPDATE orders AS o
         SET buyer_username = COALESCE(
           o.buyer_username,
           (SELECT u.username FROM users u WHERE u.id = o.user_id),
           (SELECT u.email    FROM users u WHERE u.id = o.user_id),
           '退会ユーザー'
         )
       WHERE o.buyer_username IS NULL OR o.buyer_username='';
    `);
  }catch(e){ console.warn('[BOOT] snapshot backfill warn:', e?.message||e); }
}

// まずスキーマ整備 → バックフィル
ensureOrdersSchema().then(ensureBuyerUsernameSnapshot);

/* ─────────────────────────
   5) 共通 utils / middleware
───────────────────────── */
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

/* ─────────────────────────
   6) 認証
───────────────────────── */
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
    // 過去の退会ユーザーとして存在していたか
    const prev = await dbGet(
      `SELECT 1 FROM deleted_users WHERE LOWER(username)=LOWER(?) LIMIT 1`,
      [String(username).trim()]
    );
    const r = await dbRun(
      `INSERT INTO users (username,email,password,role) VALUES (?,?,?,'user')`,
      [username.trim(), String(email||'').trim(), password]
    );
    res.json({ ok:true, id:r.lastID, reRegistered: !!prev });
  }catch(e){
    if(String(e.message||'').includes('UNIQUE')) return res.status(409).json({error:'username exists'});
    res.status(500).json({error:'DB error'});
  }
});

/* ─────────────────────────
   7) プロフィールAPI
───────────────────────── */
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
    const email = (req.body && typeof req.body.email==='string') ? String(req.body.email).trim() : undefined;
    if (email !== undefined) await dbRun(`UPDATE users SET email=? WHERE id=?`, [email, req.user.userId]);

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

    // 教育用: 平文保存（本番は bcrypt.hash で）
    await dbRun(`UPDATE users SET password=? WHERE id=?`, [String(next), req.user.userId]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'db' }); }
});

/* ─────────────────────────
   8) products
───────────────────────── */
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

/* ─────────────────────────
   9) 管理（ユーザー）※削除はスナップショット固定＋退会記録
───────────────────────── */
app.get('/api/admin/users', requireAdmin, async (_req,res)=>{
  try{
    const rows = await dbAll(`SELECT id,username,email,role,created_at,password FROM users ORDER BY id`);
    res.json(rows);
  }catch{ res.status(500).json({error:'DB error'}); }
});

// ★メール更新用（存在しなかったので追加）
app.put('/api/admin/users/:id', requireAdmin, async (req,res)=>{
  const id = Number(req.params.id);
  const email = (req.body && typeof req.body.email==='string') ? String(req.body.email).trim() : '';
  if (!Number.isInteger(id)) return res.status(400).json({error:'bad_id'});
  try{
    const r = await dbRun(`UPDATE users SET email=? WHERE id=?`, [email, id]);
    res.json({ ok:true, updated:r.changes });
  }catch{ res.status(500).json({error:'DB error'}); }
});

app.put('/api/admin/users/:id/password', requireAdmin, async (req,res)=>{
  const { id } = req.params; const { password } = req.body||{};
  if(!password) return res.status(400).json({error:'password required'});
  try{
    const r = await dbRun(`UPDATE users SET password=? WHERE id=?`, [String(password), Number(id)]);
    res.json({ ok:true, updated:r.changes });
  }catch{ res.status(500).json({error:'DB error'}); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req,res)=>{
  try{
    const uid = Number(req.params.id);
    const u = await dbGet(`SELECT id, username, email FROM users WHERE id=?`, [uid]);
    if (!u) return res.status(404).json({ error:'not_found' });

    // 1) 履歴スナップショット固定
    const snapName = u.username || u.email || '退会ユーザー';
    await dbRun(
      `UPDATE orders SET buyer_username = COALESCE(buyer_username, ?) WHERE user_id = ?`,
      [snapName, u.id]
    );

    // 2) 退会記録
    await dbRun(`INSERT INTO deleted_users (user_id, username, email) VALUES (?,?,?)`,
      [u.id, u.username || '', u.email || '']
    );

    // 3) 削除
    const r = await dbRun(`DELETE FROM users WHERE id=?`, [u.id]);
    res.json({ ok:true, deleted:r.changes, snapshot:snapName });
  } catch(e){
    console.error('admin delete user', e);
    res.status(500).json({ error:'DB error' });
  }
});
/* ─────────────────────────
   10) 在庫編集（inventory.js 用）
───────────────────────── */
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

/* ─────────────────────────
   11) 簡易バックアップ（堅牢版）
───────────────────────── */
const BACKUP_DIR = path.join(__dirname, 'backups');
function two(n){ return String(n).padStart(2,'0'); }
function tsFilename() {
  const d = new Date();
  const s = `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  return `backup_${s}.db`;
}
function safeName(raw){
  const b = String(raw||'').trim();
  const s = b.replace(/[^A-Za-z0-9_.-]/g,'');
  return s ? (s.endsWith('.db') ? s : `${s}.db`) : tsFilename();
}
function fmtSize(bytes){
  if (bytes >= 1024*1024) return `${Math.round(bytes/1024/1024)} MB`;
  if (bytes >= 1024)      return `${Math.round(bytes/1024)} KB`;
  return `${bytes} B`;
}
function fmtTime(ms){
  const d = new Date(ms);
  const s = `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return s;
}

app.get('/api/admin/backups', requireAdmin, async (_req,res)=>{
  try{
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
    const rows = [];
    for (const ent of entries) {
      if (!ent.isFile() || !/\.db$/i.test(ent.name)) continue;
      const st = await fsp.stat(path.join(BACKUP_DIR, ent.name));
      rows.push({
        filename: ent.name,        // 旧フロント互換
        name: ent.name,            // 新フロント互換
        size: st.size,
        mtime: st.mtimeMs,
        sizeText: fmtSize(st.size),
        mtimeText: fmtTime(st.mtimeMs),
      });
    }
    rows.sort((a,b)=> b.mtime - a.mtime);
    res.json(rows);
  }catch(e){
    console.error('[BACKUPS:list]', e);
    res.status(500).json([]);
  }
});

// 作成（段階的フォールバック）
app.post('/api/admin/backup', requireAdmin, async (req,res)=>{
  const name = safeName(req.body?.name);
  const src = path.join(__dirname,'shopping.db');
  const dst = path.join(BACKUP_DIR, name);

  try{
    await fsp.mkdir(BACKUP_DIR, { recursive: true });

    // 同名があれば末尾連番
    let finalDst = dst, idx = 1;
    while (true) {
      try { await fsp.access(finalDst); finalDst = path.join(BACKUP_DIR, name.replace(/\.db$/i, `_${idx++}.db`)); }
      catch { break; }
    }

    // 1) VACUUM INTO
    try{
      await new Promise((resolve, reject)=>{
        const tmp = new sqlite3.Database(src);
        tmp.serialize(()=>{
          tmp.run(`PRAGMA busy_timeout=3000`);
          tmp.run(`PRAGMA wal_checkpoint(TRUNCATE)`, ()=> {
            tmp.run(`VACUUM INTO ?`, [finalDst], (err)=>{
              tmp.close(()=>{});
              if (err) return reject(err);
              resolve();
            });
          });
        });
      });
      return res.json({ ok:true, filename: path.basename(finalDst), method: 'vacuum' });
    }catch(e1){
      console.warn('[BACKUP] VACUUM INTO failed:', e1?.message||e1);
    }

    // 2) copyFile
    try{
      await fsp.copyFile(src, finalDst);
      return res.json({ ok:true, filename: path.basename(finalDst), method: 'copy' });
    }catch(e2){
      console.warn('[BACKUP] copyFile failed:', e2?.message||e2);
    }

    // 3) stream
    try{
      await new Promise((resolve, reject)=>{
        const rs = fs.createReadStream(src);
        const ws = fs.createWriteStream(finalDst);
        let done = false;
        const bail = (err)=>{ if(!done){ done=true; reject(err);} };
        rs.on('error', bail);
        ws.on('error', bail);
        ws.on('close', ()=>{ if(!done){ done=true; resolve(); }});
        rs.pipe(ws);
      });
      return res.json({ ok:true, filename: path.basename(finalDst), method: 'stream' });
    }catch(e3){
      console.error('[BACKUP] stream copy failed:', e3?.message||e3);
      return res.status(500).json({ ok:false, error:`backup_failed` });
    }

  }catch(e){
    console.error('[BACKUPS:create] fatal', e);
    res.status(500).json({ ok:false, error: e?.message||'backup_failed' });
  }
});

// 復元（DBを一旦閉じてから置換 → 再オープン）
app.post('/api/admin/restore', requireAdmin, async (req,res)=>{
  try{
    const raw = (req.body?.filename) || (req.body?.name) || '';
    const name = String(raw).replace(/[^A-Za-z0-9_.-]/g, '');
    if (!name) return res.status(400).json({ ok:false, error:'bad_name' });

    const src = path.join(BACKUP_DIR, name);
    const dst = path.join(__dirname,'shopping.db');

    await new Promise((resolve, reject) => db.close((err)=> err ? reject(err) : resolve()));
    await fsp.copyFile(src, dst);
    db = new sqlite3.Database(dst);
    ensureAdminBootstrap();
    await ensureOrdersSchema();
    await ensureBuyerUsernameSnapshot();

    res.json({ ok:true, reloaded:true });
  }catch(e){
    console.error('[BACKUPS:restore]', e);
    res.status(500).json({ ok:false, error:e?.message||'restore_failed' });
  }
});

app.delete('/api/admin/backup/:filename', requireAdmin, async (req,res)=>{
  try{
    const name = String(req.params.filename||'').replace(/[^A-Za-z0-9_.-]/g, '');
    await fsp.unlink(path.join(BACKUP_DIR, name));
    res.json({ ok:true });
  }catch(e){
    res.status(e && e.code==='ENOENT' ? 404 : 500).json({ ok:false, error:e?.message||'delete_failed' });
  }
});

/* ─────────────────────────
   12) 決済（在庫連動・スキーマ自動適応）※buyer_username を同時保存
───────────────────────── */
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

    const buyerRow = await dbGet(`SELECT username, email FROM users WHERE id=?`, [req.user.userId]);
    const buyerName = (buyerRow?.username || buyerRow?.email || '退会ユーザー');

    const cols = [], vals = [];
    if (has('user_id'))        cols.push('user_id'),        vals.push(req.user.userId);
    if (has('order_id'))       cols.push('order_id'),       vals.push(orderCode);
    else if (has('order_code'))cols.push('order_code'),     vals.push(orderCode);
    if (has('payer_name'))     cols.push('payer_name'),     vals.push(name || '');
    if (has('card_last4'))     cols.push('card_last4'),     vals.push(last4);
    else if (has('last4'))     cols.push('last4'),          vals.push(last4);
    if (has('subtotal'))       cols.push('subtotal'),       vals.push(subtotal);
    if (has('tax'))            cols.push('tax'),            vals.push(tax);
    if (has('total'))          cols.push('total'),          vals.push(total);
    if (has('buyer_username')) cols.push('buyer_username'), vals.push(buyerName);
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

    const returnId = (has('order_id') || has('order_code')) ? orderCode : String(txResult.internalId);

    res.json({ ok:true, orderId: returnId, subtotal, tax, total, last4 });
  } catch (e) {
    console.error('[checkout]', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ─────────────────────────
   13) 直近の自分の注文
───────────────────────── */
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

/* ─────────────────────────
   14) 注文詳細
───────────────────────── */
app.get('/api/orders/:orderId', requireAuth, async (req, res) => {
  try{
    const param = String(req.params.orderId || '');
    const oCols = await dbAll(`PRAGMA table_info('orders')`);
    const onames = new Set(oCols.map(c => c.name));

    const sel = ['id','created_at'];
    if (onames.has('order_id'))   sel.push('order_id');
    if (onames.has('order_code')) sel.push('order_code');
    if (onames.has('subtotal'))   sel.push('subtotal');
    if (onames.has('tax'))        sel.push('tax');
    if (onames.has('total'))      sel.push('total');
    if (onames.has('card_last4')) sel.push('card_last4');
    if (onames.has('last4'))      sel.push('last4');

    let head = null;
    if (onames.has('order_id') || onames.has('order_code')) {
      const where = [];
      const args = [req.user.userId];
      if (onames.has('order_id'))   { where.push('order_id=?');   args.push(param); }
      if (onames.has('order_code')) { where.push('order_code=?'); args.push(param); }
      head = await dbGet(`SELECT ${sel.join(', ')} FROM orders WHERE user_id=? AND (${where.join(' OR ')})`, args);
    }
    if (!head &&/^\d+$/.test(param)) {
      head = await dbGet(`SELECT ${sel.join(', ')} FROM orders WHERE user_id=? AND id=?`, [req.user.userId, Number(param)]);
    }
    if (!head) return res.status(404).json({ error:'not_found' });

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

/* ─────────────────────────
   15) 管理: 売上集計
───────────────────────── */
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

/* ─────────────────────────
   16) 管理: 売上履歴（events）
───────────────────────── */
app.get('/api/admin/sales-events', requireAdmin, async (req, res) => {
  try {
    const productId = Number(req.query.product_id || req.query.product || 0) || null;
    const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit || '200', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    const oCols = await dbAll(`PRAGMA table_info('orders')`);
    const iCols = await dbAll(`PRAGMA table_info('order_items')`);
    const oNames = new Set(oCols.map(c => c.name));
    const iNames = new Set(iCols.map(c => c.name));

    const hasOrderId   = oNames.has('order_id');
    const hasOrderCode = oNames.has('order_code');
    const hasCreatedAt = oNames.has('created_at');
    const hasBuyer     = oNames.has('buyer_username');
    const priceCol     = iNames.has('unit_price') ? 'unit_price' : 'price';

    const orderIdCol = iCols.find(c => c.name === 'order_id');
    const isTextOrderRef = orderIdCol
      ? /TEXT|CHAR|CLOB/i.test(String(orderIdCol.type || '')) || String(orderIdCol.type||'') === ''
      : false;

    const joins = [];
    if (isTextOrderRef) {
      if (hasOrderId)   joins.push('oi.order_id = o.order_id');
      if (hasOrderCode) joins.push('oi.order_id = o.order_code');
      if (!joins.length) joins.push('oi.order_id = CAST(o.id AS TEXT)');
    } else {
      joins.push('oi.order_id = o.id');
    }
    const joinCond = joins.join(' OR ');

    const orderDispCol = hasOrderId ? 'o.order_id' : (hasOrderCode ? 'o.order_code' : 'o.id');
    const orderBy = hasCreatedAt ? 'o.created_at DESC, o.id DESC' : 'o.id DESC';

    const where = [];
    const params = [];
    if (productId) { where.push('oi.product_id = ?'); params.push(productId); }

    const userExpr = hasBuyer
      ? "COALESCE(o.buyer_username, u.username, u.email, '退会ユーザー')"
      : "COALESCE(u.username, u.email, '退会ユーザー')";

    const sql = `
      SELECT
        ${hasCreatedAt ? 'o.created_at' : "datetime('now')"} AS created_at,
        ${orderDispCol} AS order_display,
        oi.product_id   AS product_id,
        oi.name         AS product_name,
        oi.${priceCol}  AS unit_price,
        oi.qty          AS qty,
        ${userExpr}     AS buyer_username
      FROM order_items oi
      JOIN orders o ON (${joinCond})
      LEFT JOIN users u ON u.id = o.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?;
    `;
    params.push(limit, offset);

    const rows = await dbAll(sql, params);
    res.json(rows.map(r => ({
      created_at: r.created_at,
      orderId: String(r.order_display),
      productId: Number(r.product_id),
      productName: r.product_name || '',
      unitPrice: Math.round(Number(r.unit_price)||0),
      qty: Math.max(0, Number(r.qty)||0),
      subTotal: Math.round((Number(r.unit_price)||0) * (Number(r.qty)||0)),
      buyer: r.buyer_username || '退会ユーザー'
    })));
  } catch (e) {
    console.error('[admin sales-events]', e);
    res.status(500).json({ error: 'db' });
  }
});

/* ─────────────────────────
   17) 公開: ベストセラー
───────────────────────── */
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

/* ─ 管理: 売上履歴タイムライン（最新→古い）: 全件取得 + 複数条件検索（OR） + 異なるスキーマ吸収 ─ */
app.get('/api/admin/sales-timeline', requireAdmin, async (req, res) => {
  try {
    const allFlag = String(req.query.all || '').trim() === '1';
    const limit  = allFlag ? 5000 : Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
    const offset = allFlag ? 0 : Math.max(0, parseInt(req.query.offset || '0', 10));

    const splitTokens = (v) =>
      String(v || '')
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);

    const userTokens    = splitTokens(req.query.user);
    const productTokens = splitTokens(req.query.product);

    const minAmount = req.query.min ? Math.max(0, parseInt(req.query.min, 10) || 0) : null;
    const maxAmount = req.query.max ? Math.max(0, parseInt(req.query.max, 10) || 0) : null;

    const oCols = await dbAll(`PRAGMA table_info('orders')`);
    const iCols = await dbAll(`PRAGMA table_info('order_items')`).catch(() => []);
    const oiCols = await dbAll(`PRAGMA table_info('orders_items')`).catch(() => []);

    const oset = new Set(oCols.map(c => c.name));
    const hasOrderId   = oset.has('order_id');
    const hasOrderCode = oset.has('order_code');
    const hasCreatedAt = oset.has('created_at');
    const hasUserId    = oset.has('user_id');
    const hasBuyer     = oset.has('buyer_username');

    const mkItemInfo = (cols) => {
      const map = new Map(cols.map(c => [c.name, c]));
      const has = (n) => map.has(n);
      const qtyCol   = has('qty') ? 'qty' : (has('quantity') ? 'quantity' : 'qty');
      const priceCol = has('unit_price') ? 'unit_price' : (has('price') ? 'price' : 'price');
      const hasLine  = has('line_total');
      const type = String(map.get('order_id')?.type || '').toUpperCase();
      const isTextId = type.includes('TEXT') || type.includes('CHAR') || type.includes('CLOB') || type === '';
      return { qtyCol, priceCol, hasLine, isTextId };
    };

    const item1 = iCols.length ? mkItemInfo(iCols)  : null;
    const item2 = oiCols.length ? mkItemInfo(oiCols) : null;

    if (!item1 && !item2) return res.json([]);

    const orderRefExpr = (hasOrderId || hasOrderCode)
      ? `(COALESCE(o.order_id, o.order_code, CAST(o.id AS TEXT)))`
      : `CAST(o.id AS TEXT)`;
    const orderBy = hasCreatedAt ? 'datetime(o.created_at) DESC, o.id DESC' : 'o.id DESC';

    const whereParts = [];
    const whereParams = [];

    // ユーザー：OR 検索（スナップショット/現ユーザー名/メール）※buyer_username がないDBにも対応
    if (userTokens.length) {
      if (hasBuyer) {
        const orChunks = userTokens.map(() =>
          `(COALESCE(o.buyer_username,'') LIKE ? OR COALESCE(u.username,'') LIKE ? OR COALESCE(u.email,'') LIKE ?)`
        );
        whereParts.push(`(${orChunks.join(' OR ')})`);
        userTokens.forEach(tok => { whereParams.push(`%${tok}%`, `%${tok}%`, `%${tok}%`); });
      } else {
        const orChunks = userTokens.map(() =>
          `(COALESCE(u.username,'') LIKE ? OR COALESCE(u.email,'') LIKE ?)`
        );
        whereParts.push(`(${orChunks.join(' OR ')})`);
        userTokens.forEach(tok => { whereParams.push(`%${tok}%`, `%${tok}%`); });
      }
    }

    // 製品名：OR 検索
    if (productTokens.length) {
      const orChunks = productTokens.map(() => `COALESCE(oi.name, p.name, '') LIKE ?`);
      whereParts.push(`(${orChunks.join(' OR ')})`);
      productTokens.forEach(tok => whereParams.push(`%${tok}%`));
    }

    const addAmountWhere = (hasLine, priceCol, qtyCol) => {
      const parts = [];
      if (minAmount !== null) {
        parts.push(`${hasLine ? 'oi.line_total' : `(oi.${priceCol} * oi.${qtyCol})`} >= ?`);
        whereParams.push(minAmount);
      }
      if (maxAmount !== null) {
        parts.push(`${hasLine ? 'oi.line_total' : `(oi.${priceCol} * oi.${qtyCol})`} <= ?`);
        whereParams.push(maxAmount);
      }
      return parts.join(' AND ');
    };

    const makeJoin = (isTextId) => {
      if (isTextId) {
        if (hasOrderId && hasOrderCode) return '(oi.order_id = o.order_id OR oi.order_id = o.order_code)';
        if (hasOrderId)   return 'oi.order_id = o.order_id';
        if (hasOrderCode) return 'oi.order_id = o.order_code';
        return 'oi.order_id = CAST(o.id AS TEXT)';
      }
      return 'oi.order_id = o.id';
    };

    const userExpr = hasBuyer
      ? "COALESCE(o.buyer_username, u.username, u.email, '退会ユーザー')"
      : "COALESCE(u.username, u.email, '退会ユーザー')";

    const selectCommon = `
      SELECT
        ${hasCreatedAt ? 'o.created_at' : "datetime('now')"} AS created_at,
        ${orderRefExpr} AS orderRef,
        ${userExpr} AS user,
        COALESCE(oi.name, p.name, '')     AS product,
        CAST(oi.__QTY__ AS INTEGER)       AS qty,
        CAST(oi.__PRICE__ AS INTEGER)     AS unit,
        CAST(__LINE_TOTAL__ AS INTEGER)   AS line
      FROM orders o
      JOIN __ITEM_TABLE__ oi ON __JOIN_COND__
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN users    u ON ${hasUserId ? 'u.id = o.user_id' : '1=1'}
    `;

    const unions = [];
    const params = [];

    const buildOne = (tableName, info) => {
      if (!info) return;
      const join = makeJoin(info.isTextId);
      const lineExpr = info.hasLine ? 'oi.line_total' : `(oi.${info.priceCol} * oi.${info.qtyCol})`;
      const amountWhere = addAmountWhere(info.hasLine, info.priceCol, info.qtyCol);

      let sql = selectCommon
        .replace('__ITEM_TABLE__', tableName)
        .replace('__JOIN_COND__', join)
        .replace('__QTY__', info.qtyCol)
        .replace('__PRICE__', info.priceCol)
        .replace('__LINE_TOTAL__', lineExpr);

      const parts = [...whereParts];
      if (amountWhere) parts.push(amountWhere);

      if (parts.length) sql += `\nWHERE ${parts.join(' AND ')}`;

      unions.push(sql);
      params.push(...whereParams);
    };

    buildOne('order_items',  iCols.length ? mkItemInfo(iCols) : null);
    buildOne('orders_items', oiCols.length ? mkItemInfo(oiCols) : null);

    if (!unions.length) return res.json([]);

    const final = `
      ${unions.join('\nUNION ALL\n')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = await dbAll(final, params);

    res.json(rows.map(r => ({
      created_at: r.created_at,
      orderRef  : String(r.orderRef || ''),
      user      : r.user || '退会ユーザー',
      product   : r.product || '',
      qty       : Math.max(0, Number(r.qty)  || 0),
      unit      : Math.max(0, Number(r.unit) || 0),
      line      : Math.max(0, Number(r.line) || 0),
    })));
  } catch (e) {
    console.error('[sales-timeline]', e);
    res.status(500).json({ error: 'db' });
  }
});

/* ── 静的（トップ）と 404 / エラー ── */
app.get('/', (_req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req,res) => res.status(404).json({ error: 'not_found' }));

app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED]', err && err.stack ? err.stack : err);
  try {
    res.status(500).json({ error: 'server_error' });
  } catch {}
});

/* ── 起動 ── */
const server = app.listen(PORT, HOST, () => {
  console.log(`Vulnerable shopping site running on http://${HOST}:${PORT}`);
  console.log(`[ENV] dotenv loaded: ${ENV_LOADED} | ENABLE_DEV_ROOT=${DEV_ROOT} | ADMIN_DEFAULT_EMAIL=${DEV_ROOT_EMAIL} | JWT_SECRET=${process.env.JWT_SECRET ? '(set)' : '(not set)'}`);
});
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} is already in use. 別プロセスが使っています。`);
  } else {
    console.error('[FATAL] server listen error:', e);
  }
  process.exit(1);
});
