from flask import Flask, render_template_string

app = Flask(__name__)

PRODUCTS = [
    {"name": "Pythonぬいぐるみ", "desc": "かわいいパイソンのぬいぐるみ", "price": 2500, "img": "https://www.python.org/static/community_logos/python-logo.png"},
    {"name": "PyCharmライセンス", "desc": "人気IDEの1年ライセンス", "price": 12000, "img": "https://resources.jetbrains.com/storage/products/company/brand/logos/PyCharm_icon.png"},
    {"name": "Python Tシャツ", "desc": "公式ロゴ入りTシャツ", "price": 3500, "img": "https://cdn.shopify.com/s/files/1/0257/6089/9357/products/python-logo-t-shirt-black_1024x1024.png"},
]

TEMPLATE = '''
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Python製品ページ</title>
    <link rel="stylesheet" href="/static/styles.css">
    <style>
        .py-products-section { max-width: 900px; margin: 3rem auto; background: #181a2a; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.25); padding: 2.5rem; color: #fff; }
        .py-products-section h2 { color: #ffd700; margin-bottom: 2rem; }
        .py-products-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 2rem; }
        .py-product-card { background: #23244a; border-radius: 10px; padding: 1.5rem; box-shadow: 0 4px 16px rgba(0,0,0,0.18); text-align: center; }
        .py-product-card img { max-width: 120px; margin-bottom: 1rem; }
        .py-product-card h3 { margin: 0.5rem 0; color: #ffd700; }
        .py-product-card p { color: #cfd8ff; margin-bottom: 0.5rem; }
        .py-product-price { font-size: 1.3rem; font-weight: bold; color: #34d399; margin-bottom: 1rem; }
        @media (max-width: 700px) { .py-products-section { padding: 1rem; } .py-product-card { padding: 1rem; } }
    </style>
</head>
<body>
    <header>
        <nav class="navbar">
            <div class="nav-brand">
                <h1>🐍 Python製品ページ</h1>
            </div>
            <div class="nav-links">
                <a href="/">ホーム</a>
            </div>
        </nav>
    </header>
    <main>
        <section class="py-products-section">
            <h2>Python製品一覧</h2>
            <div class="py-products-grid">
                {% for p in products %}
                <div class="py-product-card">
                    <img src="{{p.img}}" alt="{{p.name}}">
                    <h3>{{p.name}}</h3>
                    <p>{{p.desc}}</p>
                    <div class="py-product-price">¥{{p.price}}</div>
                </div>
                {% endfor %}
            </div>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 Python製品ページ - 教育目的のみ</p>
    </footer>
</body>
</html>
'''

@app.route("/python-products")
def python_products():
    return render_template_string(TEMPLATE, products=PRODUCTS)

if __name__ == "__main__":
    app.run(debug=True)
