// server.js — 起動時に admin/root を確保、JWT認証、製品API、管理API、バックアップAPI、決済モック

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

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'shopping.db'));

// --- 起動時に admin/root を「必ず」上書きする
function ensureAdminBootstrap() {
  // admin → 既存があっても role/password を強制
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

  // デモ商品
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (1,'Laptop','High-performance laptop',999,10,'https://picsum.photos/seed/laptop/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (2,'Smartphone','Latest smartphone model',700,25,'https://picsum.photos/seed/phone/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (3,'Headphones','Wireless noise-cancelling headphones',200,50,'https://picsum.photos/seed/headphones/800/500')`);
  db.run(`INSERT OR IGNORE INTO products (id,name,description,price,stock,image_path)
          VALUES (4,'Anime Hero','<img src=x onerror=alert(1)>',60,100,'https://picsum.photos/seed/hero/800/500')`);

  ensureAdminBootstrap();
});

// --- 共通ユーティリティ
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

// --- 認証
app.post('/api/login', (req,res)=>{
  const { username='', password='' } = req.body||{};
  const uname = String(username).trim();
  const pass  = String(password);

  if(!uname || !pass) return res.status(400).json({error:'Bad request'});

  db.get(`SELECT * FROM users WHERE username=?`, [uname], (err,u)=>{
    if(err) return res.status(500).json({error:'DB error'});
    if(!u)  return res.status(401).json({error:'Invalid credentials'});

    let ok = false;
    if (u.password && u.password.length > 20) { // ハッシュ互換
      try { ok = bcrypt.compareSync(pass, u.password); } catch {}
    } else {
      ok = (u.password === pass);
    }
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

// --- 自分の情報
app.get('/api/me', requireAuth, (req,res)=>{
  db.get(`SELECT id,username,email,role,created_at FROM users WHERE id=?`,
    [req.user.userId],
    (e,row)=> e||!row ? res.status(500).json({error:'DB error'}) : res.json({ token:req.user, user:row })
  );
});

// --- products
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

// --- admin users
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

// メール / 権限の軽量更新（rootは保護）
function updateEmailRole(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });

  const email = (req.body && typeof req.body.email === 'string')
    ? String(req.body.email).trim()
    : undefined;
  const role  = (req.body && typeof req.body.role === 'string')
    ? String(req.body.role).trim()
    : undefined;

  db.get('SELECT username FROM users WHERE id=?', [id], (e, row) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (String(row.username).toLowerCase() === 'root') {
      return res.status(400).json({ error: 'root cannot be changed' });
    }

    const sets = [];
    const args = [];
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

// 一覧
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

// 生成（互換: /api/backup）
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

// リストア
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

// 削除
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

// --- Mock checkout API (requireAuth)
app.post('/api/checkout', requireAuth, (req, res) => {
  try {
    const { amount, items, cardLast4, name } = req.body || {};
    if (!(amount > 0) || !Array.isArray(items)) {
      return res.status(400).json({ ok:false, error:'bad_request' });
    }
    const orderId = 'ORD-' + Date.now();
    return res.json({ ok:true, orderId, charged: amount, last4: String(cardLast4||'').slice(-4), name: name||'' });
  } catch (e) {
    console.error('[checkout]', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});

// --- 静的
app.get('/', (_req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, ()=>{
  console.log(`Vulnerable shopping site running on port ${PORT}`);
  console.log(`[ENV] dotenv loaded: ${ENV_LOADED} | ENABLE_DEV_ROOT=${DEV_ROOT} | ADMIN_DEFAULT_EMAIL=${DEV_ROOT_EMAIL} | JWT_SECRET=${process.env.JWT_SECRET ? '(set)' : '(not set)'}`);
  console.log(`[BOOT] admin/admin123 と (DEV_ROOT時) root/root を強制設定しました。`);
});
