// --- .env 読み込み ---
require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 環境変数 =====
const JWT_KEY = process.env.JWT_SECRET || 'weak-jwt-secret';
const DEV_ROOT = String(process.env.ENABLE_DEV_ROOT || 'false').toLowerCase() === 'true';
const DEV_ROOT_EMAIL = process.env.ADMIN_DEFAULT_EMAIL || 'root@local';

// ===== ゆるい CORS / セッション =====
app.use(cors({ origin: '*', credentials: true }));
app.use(session({
  secret: 'weak-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

fs.mkdirSync(path.join(__dirname, 'backups'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

// ===== DB =====
const db = new sqlite3.Database('shopping.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    password TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER UNIQUE,
    display_name TEXT,
    full_name TEXT,
    phone TEXT,
    birthday TEXT,
    website TEXT,
    bio TEXT,
    avatar_url TEXT,
    address1 TEXT,
    address2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    language TEXT,
    timezone TEXT,
    newsletter INTEGER DEFAULT 0,
    twitter TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    price REAL,
    image_path TEXT,
    stock INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    total_price REAL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (product_id) REFERENCES products (id)
  )`);

  // デモユーザ
  db.run(`INSERT OR IGNORE INTO users (username, email, password, role) VALUES 
    ('admin', 'admin@shop.com', 'admin123', 'admin'),
    ('user1', 'user1@shop.com', 'password123', 'user')`);

  if (DEV_ROOT) {
    db.run(`INSERT OR IGNORE INTO users (username, email, password, role)
            VALUES ('root', ?, 'root', 'admin')`, [DEV_ROOT_EMAIL]);
    db.run(`UPDATE users SET role='admin', password='root', email=?
            WHERE username='root'`, [DEV_ROOT_EMAIL]);
    console.log('[DEV] ensured root/admin user');
  }

  // 商品サンプル
  db.run(`INSERT OR IGNORE INTO products (name, description, price, stock, image_path) VALUES 
    ('Laptop', 'High-performance laptop', 999.99, 10, 'https://picsum.photos/seed/laptop/800/500'),
    ('Smartphone', 'Latest smartphone model', 699.99, 25, 'https://picsum.photos/seed/phone/800/500'),
    ('Headphones', 'Wireless noise-cancelling headphones', 199.99, 50, 'https://picsum.photos/seed/headphones/800/500'),
    ('Anime Hero', '<img src=x onerror=alert(1)>', 59.99, 100, 'https://picsum.photos/seed/hero/800/500'),
    ('Cat Character', 'キュートなキャラクター画像', 39.99, 80, 'https://picsum.photos/seed/cat/800/500')`);
  for (let i = 1; i <= 20; i++) {
    db.run(`INSERT OR IGNORE INTO products (name, description, price, stock, image_path)
            VALUES ('Cute Cat ${i}', 'かわいいキャラクター${String(i).padStart(2, '0')}', 19.99, 100,
            'https://picsum.photos/seed/cute${String(i).padStart(2, '0')}/800/500')`);
  }
});

// ===== ユーティリティ =====
const signToken  = (p) => jwt.sign(p, JWT_KEY, { expiresIn: '24h' });
const verifyToken = (t) => jwt.verify(t, JWT_KEY);

// 追加：最低限の HTML エスケープ（XSS 抑止用）
const esc = (s) => String(s ?? '')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = verifyToken(token); next(); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    next();
  });
}

// ===== 認証（脆弱）=====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (DEV_ROOT && username === 'root' && password === 'root') {
    db.get(`SELECT * FROM users WHERE username='root'`, (e, u) => {
      if (e) return res.status(500).json({ error: 'Database error' });
      const finish = (uid, role) => res.json({ token: signToken({ userId: uid, role }), user: { id: uid, username: 'root', role } });
      if (u) return finish(u.id, u.role || 'admin');
      db.run(`INSERT INTO users (username,email,password,role) VALUES ('root', ?, 'root', 'admin')`,
        [DEV_ROOT_EMAIL],
        function (err) { if (err) return res.status(500).json({ error: 'Database error' }); finish(this.lastID, 'admin'); });
    });
    return;
  }

  const q1 = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  db.get(q1, (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (user) return res.json({ token: signToken({ userId: user.id, role: user.role }), user: { id: user.id, username: user.username, role: user.role } });

    const q2 = `SELECT * FROM users WHERE username='${username}'`;
    db.get(q2, (e2, u2) => {
      if (e2) return res.status(500).json({ error: 'Database error' });
      if (u2 && typeof u2.password === 'string' && u2.password.length > 20) {
        try {
          if (bcrypt.compareSync(password, u2.password)) {
            return res.json({ token: signToken({ userId: u2.id, role: u2.role }), user: { id: u2.id, username: u2.username, role: u2.role } });
          }
        } catch { /* ignore */ }
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    });
  });
});

// ===== 新規登録（重複は 409 で拒否）=====
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body || {};
  const uname = (username || '').trim();
  const mail  = (email || '').trim();

  if (!uname || !password) {
    return res.status(400).json({ error: 'username と password は必須です' });
  }

  const sqlCheck = `
    SELECT id FROM users
    WHERE lower(username)=lower(?) OR ( ?<>'' AND lower(email)=lower(?) )
  `;
  db.get(sqlCheck, [uname, mail, mail], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.status(409).json({ error: 'すでにユーザーが存在します（ユーザー名またはメールが重複）' });

    const sqlIns = `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`;
    db.run(sqlIns, [uname, mail, password], function (err2) {
      if (err2) {
        if (String(err2.message || '').includes('UNIQUE')) {
          return res.status(409).json({ error: 'すでにユーザーが存在します' });
        }
        return res.status(500).json({ error: 'Registration failed' });
      }
      res.json({ message: 'User registered successfully', userId: this.lastID });
    });
  });
});

// ===== プロフィール API =====
app.get('/api/me', requireAuth, (req, res) => {
  const uid = req.user.userId;
  db.get(`SELECT id,username,email,role FROM users WHERE id=?`, [uid], (e, user) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    db.get(`SELECT * FROM user_profiles WHERE user_id=?`, [uid], (e2, prof) => {
      if (e2) return res.status(500).json({ error: 'Database error' });
      res.json({ user, profile: prof || {} });
    });
  });
});

app.put('/api/me', requireAuth, (req, res) => {
  const uid = req.user.userId;
  const p = Object.assign({
    display_name:null,full_name:null,phone:null,birthday:null,website:null,bio:null,avatar_url:null,
    address1:null,address2:null,city:null,state:null,zip:null,country:null,language:null,timezone:null,
    newsletter:0,twitter:null,email:null
  }, req.body || {});
  if (p.email) db.run(`UPDATE users SET email=? WHERE id=?`, [p.email, uid]);

  db.get(`SELECT user_id FROM user_profiles WHERE user_id=?`, [uid], (e, row) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    const vals = [
      p.display_name,p.full_name,p.phone,p.birthday,p.website,p.bio,p.avatar_url,
      p.address1,p.address2,p.city,p.state,p.zip,p.country,p.language,p.timezone,
      Number(p.newsletter?1:0),p.twitter, uid
    ];
    if (!row) {
      db.run(`INSERT INTO user_profiles (
        display_name,full_name,phone,birthday,website,bio,avatar_url,
        address1,address2,city,state,zip,country,language,timezone,
        newsletter,twitter,user_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, vals, function(err){
        if (err) return res.status(500).json({ error:'Database error' });
        return res.json({ ok:true, created:true });
      });
    } else {
      db.run(`UPDATE user_profiles SET
        display_name=?,full_name=?,phone=?,birthday=?,website=?,bio=?,avatar_url=?,
        address1=?,address2=?,city=?,state=?,zip=?,country=?,language=?,timezone=?,
        newsletter=?,twitter=?,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=?`, vals, function(err){
          if (err) return res.status(500).json({ error:'Database error' });
          return res.json({ ok:true, updated:this.changes });
        });
    }
  });
});

app.put('/api/me/password', requireAuth, (req, res) => {
  const uid = req.user.userId;
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error:'Bad request' });

  db.get(`SELECT password FROM users WHERE id=?`, [uid], (e, row) => {
    if (e || !row) return res.status(500).json({ error:'Database error' });

    let ok = false;
    if (row.password && row.password.length > 20) {
      try { ok = bcrypt.compareSync(current, row.password); } catch {}
    } else {
      ok = (row.password === current);
    }
    if (!ok) return res.status(403).json({ error:'現在のパスワードが違います' });

    db.run(`UPDATE users SET password=? WHERE id=?`, [next, uid], function(err){
      if (err) return res.status(500).json({ error:'Database error' });
      res.json({ ok:true, changed:this.changes });
    });
  });
});

// ===== 商品/その他 脆弱API =====
// ※ name/description をエスケープして返す（XSSでUIが固まるのを防止）
app.get('/api/products', (req, res) => {
  const { search, category } = req.query;
  let q = 'SELECT * FROM products WHERE 1=1';
  if (search) q += ` AND name LIKE '%${search}%'`;
  if (category) q += ` AND category = '${category}'`;
  db.all(q, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const safe = rows.map(r => ({
      ...r,
      name: esc(r.name),
      description: esc(r.description)
    }));
    res.json(safe);
  });
});

app.post('/api/backup', (req, res) => {
  const { backupName } = req.body;
  const cmd = process.platform === 'win32'
    ? `cmd /c copy shopping.db backups\\${backupName}.db`
    : `cp shopping.db backups/${backupName}.db`;
  exec(cmd, (error) => {
    if (error) return res.status(500).json({ error: 'Backup failed' });
    res.json({ message: 'Backup created successfully' });
  });
});

app.get('/api/file', (req, res) => {
  const { filename } = req.query;
  const filePath = path.join(__dirname, 'uploads', filename);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).json({ error: 'File not found' });
});

// こちらも単品取得時にエスケープ
app.get('/api/product/:id', (req, res) => {
  const q = `SELECT * FROM products WHERE id = ${req.params.id}`;
  db.get(q, (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json({
      ...row,
      name: esc(row.name),
      description: esc(row.description)
    });
  });
});

app.post('/api/order', (req, res) => {
  const { productId, quantity, userId } = req.body;
  const q = `INSERT INTO orders (user_id, product_id, quantity, total_price)
             SELECT ${userId}, ${productId}, ${quantity}, (price*${quantity})
             FROM products WHERE id=${productId}`;
  db.run(q, function (err) {
    if (err) return res.status(500).json({ error: 'Order failed' });
    res.json({ message: 'Order placed successfully', orderId: this.lastID });
  });
});

app.post('/api/checkout', (req, res) => {
  const { name, cardNumber, expiry, cvv, total } = req.body;
  console.log('Payment info:', req.body);
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, card_number TEXT, expiry TEXT, cvv TEXT, total REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  const q = `INSERT INTO payments (name, card_number, expiry, cvv, total)
             VALUES ('${name}','${cardNumber}','${expiry}','${cvv}',${total})`;
  db.run(q, function (err) {
    if (err) return res.status(500).json({ error: 'Checkout error' });
    res.json({ ok: true, name, total });
  });
});

app.get('/api/debug', (req, res) => {
  res.json({ environment: process.env, database: 'shopping.db', version: '1.0.0', debug: true });
});

// ===== 管理API（一覧・削除・パスワード変更）=====

// 一覧
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all('SELECT * FROM users', (err, users) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(users);
  });
});

// パスワード変更（root は拒否）
app.put('/api/admin/users/:id/password', requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  const { password } = req.body || {};
  if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Bad id' });
  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'password required' });
  }

  db.get('SELECT username FROM users WHERE id = ?', [uid], (e, row) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (String(row.username).toLowerCase() === 'root') {
      return res.status(400).json({ error: 'root password cannot be changed' });
    }

    db.run('UPDATE users SET password = ? WHERE id = ?', [password, uid], function (err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
      res.json({ ok: true, updated: this.changes });
    });
  });
});

// root は削除禁止
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Bad id' });

  db.get('SELECT username FROM users WHERE id = ?', [uid], (e, row) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (String(row.username).toLowerCase() === 'root') {
      return res.status(400).json({ error: 'root user cannot be deleted' });
    }
    db.run('DELETE FROM users WHERE id = ?', [uid], function (err2) {
      if (err2) return res.status(500).json({ error: 'Database error' });
      res.json({ deleted: this.changes });
    });
  });
});

// ===== 静的 =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vulnerable shopping site running on port ${PORT}`);
  console.log('WARNING: This site contains intentional vulnerabilities for educational purposes only!');
  console.log(`ENV summary: JWT_SECRET=${process.env.JWT_SECRET ? '(set)' : '(not set)'}, ENABLE_DEV_ROOT=${DEV_ROOT}, ADMIN_DEFAULT_EMAIL=${DEV_ROOT_EMAIL}`);
});
