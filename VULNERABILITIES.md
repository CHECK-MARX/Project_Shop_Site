# 脆弱性詳細ドキュメント

このドキュメントでは、Vulnerable Shopping Siteに実装されている脆弱性の詳細な説明と、それらを悪用する方法、修正方法について説明します。

## Critical レベル脆弱性

### 1. SQLインジェクション (CVE-2023-1111)

**影響度**: Critical  
**CVSS Score**: 9.8

#### 脆弱性の詳細
- ログイン機能でユーザー入力を直接SQLクエリに組み込んでいる
- パラメータ化クエリを使用していない
- 入力検証とサニタイゼーションが不十分

#### 悪用方法
```sql
-- ログイン画面でのSQLインジェクション
ユーザー名: admin' --
パスワード: 任意

-- 商品検索でのSQLインジェクション
検索語: ' UNION SELECT username, password, email FROM users --
```

#### 修正方法
```javascript
// 修正前（脆弱）
const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;

// 修正後（安全）
const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
db.get(query, [username, password], callback);
```

### 2. コマンドインジェクション (CVE-2023-5555)

**影響度**: Critical  
**CVSS Score**: 9.8

#### 脆弱性の詳細
- バックアップ機能でユーザー入力を直接コマンドに組み込んでいる
- `child_process.exec()`の不適切な使用

#### 悪用方法
```bash
# バックアップ名にコマンドを注入
backupName: "; cat /etc/passwd; echo "
backupName: "; rm -rf /; echo "
```

#### 修正方法
```javascript
// 修正前（脆弱）
const command = `cp shopping.db backups/${backupName}.db`;
require('child_process').exec(command, callback);

// 修正後（安全）
const path = require('path');
const fs = require('fs');
const safeBackupName = path.basename(backupName);
const sourcePath = path.join(__dirname, 'shopping.db');
const destPath = path.join(__dirname, 'backups', safeBackupName + '.db');
fs.copyFileSync(sourcePath, destPath);
```

### 3. 認証バイパス (CVE-2023-0001)

**影響度**: Critical  
**CVSS Score**: 9.1

#### 脆弱性の詳細
- 弱いJWTシークレット（'weak-jwt-secret'）
- ハードコードされたパスワード
- 適切な認証チェックの欠如

#### 悪用方法
```javascript
// JWTトークンの偽造
const jwt = require('jsonwebtoken');
const fakeToken = jwt.sign({ userId: 1, role: 'admin' }, 'weak-jwt-secret');
```

#### 修正方法
```javascript
// 修正前（脆弱）
const token = jwt.sign(payload, 'weak-jwt-secret', { expiresIn: '24h' });

// 修正後（安全）
const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
```

## High レベル脆弱性

### 4. クロスサイトスクリプティング (XSS) (CVE-2023-7777)

**影響度**: High  
**CVSS Score**: 8.8

#### 脆弱性の詳細
- ユーザー入力を出力エンコーディングなしで表示
- DOM操作でのXSS
- ストアドXSSの可能性

#### 悪用方法
```html
<!-- 検索ボックスでのXSS -->
<script>alert('XSS')</script>

<!-- 商品名でのXSS -->
<img src="x" onerror="alert('XSS')">

<!-- カート表示でのXSS -->
<script>fetch('/api/admin/users').then(r=>r.json()).then(d=>console.log(d))</script>
```

#### 修正方法
```javascript
// 修正前（脆弱）
card.innerHTML = `<h3>${product.name}</h3>`;

// 修正後（安全）
const h3 = document.createElement('h3');
h3.textContent = product.name;
card.appendChild(h3);
```

### 5. クロスサイトリクエストフォージェリ (CSRF) (CVE-2023-8888)

**影響度**: High  
**CVSS Score**: 8.1

#### 脆弱性の詳細
- CSRFトークンの実装なし
- 状態変更操作でのCSRF保護なし

#### 悪用方法
```html
<!-- 悪意のあるサイトからの攻撃 -->
<form action="http://localhost:3000/api/order" method="POST">
    <input type="hidden" name="productId" value="1">
    <input type="hidden" name="quantity" value="100">
    <input type="hidden" name="userId" value="1">
</form>
<script>document.forms[0].submit();</script>
```

#### 修正方法
```javascript
// CSRFトークンの実装
const csrf = require('csurf');
app.use(csrf({ cookie: true }));

// フォームにトークンを追加
app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});
```

### 6. パストラバーサル (CVE-2023-6666)

**影響度**: High  
**CVSS Score**: 7.5

#### 脆弱性の詳細
- ファイルパスの検証なし
- ディレクトリトラバーサル攻撃の可能性

#### 悪用方法
```bash
# システムファイルへのアクセス
filename: ../../../etc/passwd
filename: ../../../etc/shadow
filename: ../../../var/log/auth.log
```

#### 修正方法
```javascript
// 修正前（脆弱）
const filePath = path.join(__dirname, 'uploads', filename);

// 修正後（安全）
const safeFilename = path.basename(filename);
const filePath = path.join(__dirname, 'uploads', safeFilename);
```

## Medium レベル脆弱性

### 7. 情報漏洩 (CVE-2023-9999)

**影響度**: Medium  
**CVSS Score**: 6.5

#### 脆弱性の詳細
- デバッグエンドポイントの存在
- 環境変数の露出
- ユーザーパスワードの露出

#### 悪用方法
```bash
# デバッグ情報の取得
curl http://localhost:3000/api/debug

# ユーザー情報の取得（管理者権限が必要）
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/users
```

#### 修正方法
```javascript
// 修正前（脆弱）
app.get('/api/debug', (req, res) => {
    res.json({
        environment: process.env,
        database: 'shopping.db',
        version: '1.0.0',
        debug: true
    });
});

// 修正後（安全）
// デバッグエンドポイントを削除
// 本番環境ではデバッグ情報を無効化
```

### 8. セキュリティヘッダーの欠如 (CVE-2023-1234)

**影響度**: Medium  
**CVSS Score**: 6.1

#### 脆弱性の詳細
- CORS設定の不適切な設定（origin: '*'）
- セキュリティヘッダーの欠如

#### 修正方法
```javascript
// 修正前（脆弱）
app.use(cors({
    origin: '*',
    credentials: true
}));

// 修正後（安全）
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true
}));

// セキュリティヘッダーの追加
const helmet = require('helmet');
app.use(helmet());
```

### 9. レート制限の欠如 (CVE-2023-5678)

**影響度**: Medium  
**CVSS Score**: 5.3

#### 脆弱性の詳細
- APIエンドポイントでのレート制限なし
- ブルートフォース攻撃への対策なし

#### 修正方法
```javascript
// レート制限の実装
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 100, // 最大100リクエスト
    message: 'Too many requests from this IP'
});

app.use('/api/', limiter);

// ログイン用の厳しいレート制限
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts'
});

app.use('/api/login', loginLimiter);
```

### 10. セッション管理の問題 (CVE-2023-9012)

**影響度**: Medium  
**CVSS Score**: 5.4

#### 脆弱性の詳細
- 弱いセッションシークレット
- 不適切なクッキー設定

#### 修正方法
```javascript
// 修正前（脆弱）
app.use(session({
    secret: 'weak-secret-key',
    cookie: {
        secure: false,
        httpOnly: false
    }
}));

// 修正後（安全）
app.use(session({
    secret: process.env.SESSION_SECRET,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));
```

## セキュリティテストの実行

### 自動化ツール
- **OWASP ZAP**: Webアプリケーションの脆弱性スキャン
- **Burp Suite**: 手動セキュリティテスト
- **SQLMap**: SQLインジェクションの自動検出

### 手動テスト
1. 入力検証のテスト
2. 認証と認可のテスト
3. セッション管理のテスト
4. エラーハンドリングのテスト

## セキュアコーディングのベストプラクティス

1. **入力検証**: すべてのユーザー入力を検証
2. **出力エンコーディング**: XSS対策
3. **パラメータ化クエリ**: SQLインジェクション対策
4. **認証と認可**: 適切なアクセス制御
5. **セッション管理**: セキュアなセッション設定
6. **エラーハンドリング**: 情報漏洩の防止
7. **ログ記録**: セキュリティイベントの記録
8. **定期的な更新**: 依存関係の更新

## 参考資料

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
