const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// SQLite DBセットアップ（メモリDB、サンプルデータ）
const db = new sqlite3.Database(':memory:');
db.serialize(() => {
  db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT)`);
  db.run(`INSERT INTO users (username, password) VALUES ('admin', 'admin123'), ('user', 'userpass')`);
});

// 静的ファイル
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));

// 商品データ
const products = [
  { id: 1, name: 'ぬいぐるみ', price: 1500 },
  { id: 2, name: 'Tシャツ', price: 2500 },
  { id: 3, name: 'マグカップ', price: 1200 },
];

// GET /
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>DAST脆弱性デモショップ</title>
      <link rel="stylesheet" href="/public/styles.css">
    </head>
    <body>
      <h1>DAST脆弱性デモショップ</h1>
      <ul>
        <li><a href="/products">商品一覧</a></li>
        <li><a href="/login">ログイン</a></li>
      </ul>
      <footer><small>&copy; 2024 DAST Vuln Demo Shop</small></footer>
    </body>
    </html>
  `);
});

// GET /products
app.get('/products', (req, res) => {
  const rows = products.map(p => `<tr><td>${p.id}</td><td>${p.name}</td><td>¥${p.price}</td></tr>`).join('');
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>商品一覧 - DAST脆弱性デモショップ</title>
      <link rel="stylesheet" href="/public/styles.css">
    </head>
    <body>
      <h1>商品一覧</h1>
      <table border="1" cellpadding="8">
        <thead><tr><th>ID</th><th>商品名</th><th>価格</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><a href="/">← トップへ戻る</a></p>
      <footer><small>&copy; 2024 DAST Vuln Demo Shop</small></footer>
    </body>
    </html>
  `);
});

// GET /login
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>ログイン - DAST脆弱性デモショップ</title>
      <link rel="stylesheet" href="/public/styles.css">
    </head>
    <body>
      <h1>ログイン</h1>
      <form method="POST" action="/login">
        <label>ユーザー名: <input type="text" name="username"></label><br><br>
        <label>パスワード: <input type="password" name="password"></label><br><br>
        <button type="submit">ログイン</button>
      </form>
      <p><a href="/">← トップへ戻る</a></p>
      <footer><small>&copy; 2024 DAST Vuln Demo Shop</small></footer>
    </body>
    </html>
  `);
});

// POST /login（SQLインジェクション脆弱性あり）
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  // 脆弱なSQL（パラメータバインドなし）
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  db.get(query, (err, user) => {
    if (user) {
      res.send(`
        <html><body>
        <h1>ログイン成功</h1>
        <p>ようこそ、${user.username}さん！</p>
        <a href="/">トップへ戻る</a>
        </body></html>
      `);
    } else {
      res.send(`
        <html><body>
        <h1>ログイン失敗</h1>
        <p>ユーザー名またはパスワードが違います。</p>
        <a href="/login">再試行</a>
        </body></html>
      `);
    }
  });
});

// サーバ起動
app.listen(PORT, () => {
  console.log(`DAST脆弱性デモショップが http://localhost:${PORT} で起動しました`);
});
