# GitHub リポジトリ作成手順

このプロジェクトをGitHubにプッシュするには、まずGitHubでリポジトリを作成する必要があります。

## 手順

1. GitHubにログインして https://github.com/CHECK-MARX にアクセス
2. "New repository" ボタンをクリック
3. リポジトリ名: `vulnerable-shopping-site`
4. 説明: `Educational shopping site with intentional CVE vulnerabilities for security learning`
5. Public を選択
6. "Create repository" をクリック

## リポジトリ作成後のコマンド

リポジトリが作成されたら、以下のコマンドを実行してください：

```bash
git push -u origin main
```

## 代替案: GitHub CLI を使用

GitHub CLIがインストールされている場合：

```bash
gh repo create CHECK-MARX/vulnerable-shopping-site --public --description "Educational shopping site with intentional CVE vulnerabilities for security learning"
git push -u origin main
```

## プロジェクトの特徴

このプロジェクトには以下の脆弱性が含まれています：

### Critical レベル
- SQLインジェクション (CVE-2023-1111)
- コマンドインジェクション (CVE-2023-5555)
- 認証バイパス (CVE-2023-0001)

### High レベル
- XSS (CVE-2023-7777)
- CSRF (CVE-2023-8888)
- パストラバーサル (CVE-2023-6666)

### Medium レベル
- 情報漏洩 (CVE-2023-9999)
- セキュリティヘッダーの欠如 (CVE-2023-1234)
- レート制限の欠如 (CVE-2023-5678)
- セッション管理の問題 (CVE-2023-9012)

## 使用方法

1. `npm install` で依存関係をインストール
2. `npm start` でサーバーを起動
3. `http://localhost:3000` にアクセス

## デフォルトアカウント

- 管理者: username: `admin`, password: `admin123`
- 一般ユーザー: username: `user1`, password: `password123`

⚠️ **警告**: このサイトは教育目的のみで使用してください。本番環境では絶対に使用しないでください。
