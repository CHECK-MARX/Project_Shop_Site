const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// 静的ファイル（/public配下）
app.use('/public', express.static(path.join(__dirname, 'public')));

// 商品データ（サンプル）
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
      <title>DASTデモショップ</title>
      <link rel="stylesheet" href="/public/styles.css">
    </head>
    <body>
      <h1>DASTスキャナ検出用デモショップ</h1>
      <ul>
        <li><a href="/products">商品一覧</a></li>
        <li><a href="/login">ログイン</a></li>
      </ul>
      <footer><small>&copy; 2024 DAST Demo Shop</small></footer>
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
      <title>商品一覧 - DASTデモショップ</title>
      <link rel="stylesheet" href="/public/styles.css">
    </head>
    <body>
      <h1>商品一覧</h1>
      <table border="1" cellpadding="8">
        <thead><tr><th>ID</th><th>商品名</th><th>価格</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><a href="/">← トップへ戻る</a></p>
      <footer><small>&copy; 2024 DAST Demo Shop</small></footer>
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
      <title>ログイン - DASTデモショップ</title>
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
      <footer><small>&copy; 2024 DAST Demo Shop</small></footer>
    </body>
    </html>
  `);
});

// サーバ起動
app.listen(PORT, () => {
  console.log(`DASTデモショップが http://localhost:${PORT} で起動しました`);
});
