// server.js ーー 完全置き換え版
require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

// ===== 環境変数（重要） =====
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_long_random_string'; // ←発行/検証で共通使用
const ENABLE_DEV_ROOT = (process.env.ENABLE_DEV_ROOT === 'true');            // ←開発中だけ true
const ADMIN_DEFAULT_EMAIL = process.env.ADMIN_DEFAULT_EMAIL || 'root@local';

const app = express();

// ===== わざと脆弱な設定（教材用） =====
app.use(cors({ origin: '*', credentials: true })); // CORS 過剰許可
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

// ===== DB 初期化 =====
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

  // デモ用データ（平文パスワード）
  const adminPassword = 'admin123';
  const hashed = bcrypt.hashSync(adminPassword, 10); // 使わないが一応生成
  db.run(`INSERT OR IGNORE INTO users (username, email, password, role) VALUES 
    ('admin','admin@shop.com','admin123','admin'),
    ('user1','user1@shop.com','password123','user')`);

  db.run(`INSERT OR IGNORE INTO products (name, description, price, stock, image_path) VALUES 
    ('Laptop','High-performance laptop',999.99,10,'https://picsum.photos/seed/laptop/800/500'),
    ('Smartphone','Latest smartphone model',699.99,25,'https://picsum.photos/seed/phone/800/500'),
    ('Headphones','Wireless noise-cancelling headphones',199.99,50,'https://picsum.photos/seed/headphones/800/500'),
    ('Anime Hero','<img src=x onerror=alert(1)>',59.99,100,'https://picsum.photos/seed/hero/800/500'),
    ('Cat Character','キュートなキャラクター画像',39.99,80,'https://picsum.photos/seed/cat/800/500')`);

  const bulk = [];
  for (let i = 1; i <= 20; i++) {
    bulk.push(`('Cute Cat ${i}','かわいいキャラクター${String(i).padStart(2, '0')}',19.99,100,'https://picsum.photos/seed/cute${String(i).padStart(2, '0')}/800/500')`);
  }
  db.run(`INSERT OR IGNORE INTO products (name, description, price, stock, image_path) VALUES ${bulk.join(',')}`);
});

// ===== ヘルパ =====
function issueToken(user) {
  return jwt.sign({ userId: user.id, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET); // ←ここも同じ秘密鍵で検証
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    req.auth = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ===== API 群（教材用の脆弱さは元のまま） =====

// 1) ログイン（root/root ショートカット + 平文/ハッシュ両対応）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  // ★ 開発用ショートカット（.env で ENABLE_DEV_ROOT=true の時のみ）
  if (ENABLE_DEV_ROOT && username === 'root' && password === 'root') {
    const adminUser = { id: 0, username: 'root', role: 'admin', email: ADMIN_DEFAULT_EMAIL };
    const token = issueToken(adminUser);
    return res.json({ token, user: adminUser });
  }

  // 平文認証（意図的に脆弱）
  const qPlain = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  db.get(qPlain, (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (user) {
      const token = issueToken(user);
      return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    }
    // ハッシュ対応（脆弱検索のまま）
    const qOne = `SELECT * FROM users WHERE username='${username}'`;
    db.get(qOne, (e2, u2) => {
      if (e2) return res.status(500).json({ error: 'Database error' });
      if (u2 && typeof u2.password === 'string' && u2.password.length > 20) {
        try {
          if (bcrypt.compareSync(password, u2.password)) {
            const token = issueToken(u2);
            return res.json({ token, user: { id: u2.id, username: u2.username, role: u2.role } });
          }
        } catch {}
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    });
  });
});

// 2) 登録（脆弱のまま）
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  const q = `INSERT OR REPLACE INTO users (id, username, email, password, role) 
             VALUES ((SELECT id FROM users WHERE username='${username}'),'${username}','${email}','${password}','user')`;
  db.run(q, function(err) {
    if (err) return res.status(500).json({ error: 'Registration failed' });
    res.json({ message: 'User registered successfully', userId: this.lastID });
  });
});

// 3) 商品検索（脆弱のまま）
app.get('/api/products', (req, res) => {
  const { search, category } = req.query;
  let q = 'SELECT * FROM products WHERE 1=1';
  if (search)   q += ` AND name LIKE '%${search}%'`;
  if (category) q += ` AND category='${category}'`;
  db.all(q, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// 4) 管理者：ユーザー一覧（JWT_SECRET で検証）
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all('SELECT * FROM users ORDER BY id ASC', (err, users) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(users);
  });
});

// 以下は元の脆弱エンドポイント（そのまま）
app.post('/api/backup', (req, res) => {
  const { backupName } = req.body;
  const command = `cp shopping.db backups/${backupName}.db`;
  require('child_process').exec(command, (error) => {
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

app.get('/api/product/:id', (req, res) => {
  const productId = req.params.id;
  const q = `SELECT * FROM products WHERE id = ${productId}`;
  db.get(q, (err, product) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (product) res.json(product);
    else res.status(404).json({ error: 'Product not found' });
  });
});

app.post('/api/order', (req, res) => {
  const { productId, quantity, userId } = req.body;
  const q = `INSERT INTO orders (user_id, product_id, quantity, total_price)
             SELECT ${userId}, ${productId}, ${quantity}, (price * ${quantity})
             FROM products WHERE id = ${productId}`;
  db.run(q, function(err) {
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
  db.run(q, function(err){
    if (err) return res.status(500).json({ error: 'Checkout error' });
    return res.json({ ok: true, name, total });
  });
});

app.get('/api/debug', (req, res) => {
  res.json({ environment: process.env, database: 'shopping.db', version: '1.0.0', debug: true });
});

// ===== 静的配信 =====
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===== 起動 =====
app.listen(PORT, () => {
  console.log(`Vulnerable shopping site running on port ${PORT}`);
  console.log('WARNING: This site contains intentional vulnerabilities for educational purposes only!');
  console.log(`ENV summary: JWT_SECRET=${JWT_SECRET ? '(set)' : '(missing)'}, ENABLE_DEV_ROOT=${ENABLE_DEV_ROOT}, ADMIN_DEFAULT_EMAIL=${ADMIN_DEFAULT_EMAIL}`);
});
