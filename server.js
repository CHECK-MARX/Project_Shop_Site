// --- .env 読み込み（必要なら: require('dotenv').config({ path: ['.env.local','.env'] }) ---
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

// フォルダ用意（デモ用）
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

  // DEV_ROOT=true のとき root を admin で必ず用意＆補正（role/password/email）
  if (DEV_ROOT) {
    db.run(
      `INSERT OR IGNORE INTO users (username, email, password, role)
       VALUES ('root', ?, 'root', 'admin')`,
      [DEV_ROOT_EMAIL]
    );
    db.run(
      `UPDATE users
         SET role='admin', password='root', email=?
       WHERE username='root'`,
      [DEV_ROOT_EMAIL]
    );
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

// ===== 認証（脆弱：SQLi & 弱い JWT）=====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  // DEV_ROOT ショートカット：root/root は必ず admin でログイン
  if (DEV_ROOT && username === 'root' && password === 'root') {
    db.get(`SELECT * FROM users WHERE username='root'`, (e, u) => {
      if (e) return res.status(500).json({ error: 'Database error' });
      const finish = (uid, role) => {
        const token = jwt.sign({ userId: uid, role }, JWT_KEY, { expiresIn: '24h' });
        res.json({ token, user: { id: uid, username: 'root', role } });
      };
      if (u) return finish(u.id, u.role || 'admin');
      db.run(
        `INSERT INTO users (username,email,password,role) VALUES ('root', ?, 'root', 'admin')`,
        [DEV_ROOT_EMAIL],
        function (err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          finish(this.lastID, 'admin');
        }
      );
    });
    return;
  }

  // 脆弱：平文照合
  const q1 = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  db.get(q1, (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (user) {
      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_KEY, { expiresIn: '24h' });
      return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    }
    // 代替：ハッシュ対応（依然として注入可能）
    const q2 = `SELECT * FROM users WHERE username='${username}'`;
    db.get(q2, (e2, u2) => {
      if (e2) return res.status(500).json({ error: 'Database error' });
      if (u2 && typeof u2.password === 'string' && u2.password.length > 20) {
        try {
          if (bcrypt.compareSync(password, u2.password)) {
            const token = jwt.sign({ userId: u2.id, role: u2.role }, JWT_KEY, { expiresIn: '24h' });
            return res.json({ token, user: { id: u2.id, username: u2.username, role: u2.role } });
          }
        } catch { /* noop */ }
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    });
  });
});

// 登録（脆弱）
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  const q = `INSERT OR REPLACE INTO users (id, username, email, password, role)
             VALUES ((SELECT id FROM users WHERE username='${username}'),
                     '${username}', '${email}', '${password}', 'user')`;
  db.run(q, function (err) {
    if (err) return res.status(500).json({ error: 'Registration failed' });
    res.json({ message: 'User registered successfully', userId: this.lastID });
  });
});

// ===== 商品API（脆弱検索）=====
app.get('/api/products', (req, res) => {
  const { search, category } = req.query;
  let q = 'SELECT * FROM products WHERE 1=1';
  if (search) q += ` AND name LIKE '%${search}%'`;
  if (category) q += ` AND category = '${category}'`;
  db.all(q, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// ===== デモ脆弱API =====
app.post('/api/backup', (req, res) => {
  const { backupName } = req.body;
  // OS別に雑に分岐（依然としてコマンドインジェクション脆弱）
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
  const filePath = path.join(__dirname, 'uploads', filename); // パストラバーサル脆弱
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).json({ error: 'File not found' });
});

app.get('/api/product/:id', (req, res) => {
  const q = `SELECT * FROM products WHERE id = ${req.params.id}`;
  db.get(q, (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row); // XSS 脆弱
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
  console.log('Payment info:', req.body); // 情報漏洩
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

// ===== 管理API（一覧・削除）=====
function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_KEY);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all('SELECT * FROM users', (err, users) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(users);
  });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Bad id' });
  db.run('DELETE FROM users WHERE id = ?', [uid], function (err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ deleted: this.changes });
  });
});

// ===== 静的ページ =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vulnerable shopping site running on port ${PORT}`);
  console.log('WARNING: This site contains intentional vulnerabilities for educational purposes only!');
  console.log(`ENV summary: JWT_SECRET=${process.env.JWT_SECRET ? '(set)' : '(not set)'}, ENABLE_DEV_ROOT=${DEV_ROOT}, ADMIN_DEFAULT_EMAIL=${DEV_ROOT_EMAIL}`);
});
