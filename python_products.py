import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta

from flask import Flask, jsonify, redirect, render_template_string, request

app = Flask(__name__)

DB_PATH = "shopping.db"
DEFAULT_WEEKLY_WINDOW = 12
LOW_STOCK_THRESHOLD = 5


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def parse_dt(value):
    if not value:
        return None
    value = str(value).strip()
    if not value:
        return None
    value = value.replace("Z", "")
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def coerce_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def row_get(row, key, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return default


def pick_value(row, fields, default=None):
    for name in fields:
        val = row_get(row, name)
        if val not in (None, ""):
            return val
    return default


def pick_numeric(row, fields, default=0.0):
    val = pick_value(row, fields)
    if val is None:
        return default
    fallback = default if isinstance(default, (int, float)) and default is not None else 0.0
    return coerce_float(val, default=fallback)


def pick_text(row, fields, default=""):
    val = pick_value(row, fields)
    if val is None:
        return default
    return str(val)


def pick_datetime(row, fields):
    for name in fields:
        dt = parse_dt(row_get(row, name))
        if dt:
            return dt
    return None


def fetch_products():
    """Return product rows for the catalogue page."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, name, description, price, image_path, stock "
            "FROM products ORDER BY id DESC"
        ).fetchall()
    finally:
        conn.close()

    products = [
        {
            "id": row["id"],
            "name": row["name"],
            "desc": row["description"],
            "price": row["price"],
            "img": row["image_path"],
            "stock": row["stock"],
        }
        for row in rows
    ]

    if not products:
        products = [
            {
                "id": 0,
                "name": "Pythonぬいぐるみ",
                "desc": "かわいいパイソンのぬいぐるみ",
                "price": 2500,
                "img": "https://www.python.org/static/community_logos/python-logo.png",
                "stock": "?",
            }
        ]

    return products


def gather_metrics(
    range_days=30,
    weekly_window=DEFAULT_WEEKLY_WINDOW,
    low_stock_threshold=LOW_STOCK_THRESHOLD,
):
    range_days = max(1, min(int(range_days or 30), 365))
    weekly_window = max(1, min(int(weekly_window or DEFAULT_WEEKLY_WINDOW), 52))
    low_stock_threshold = max(0, int(low_stock_threshold))
    since = datetime.utcnow() - timedelta(days=range_days - 1)

    conn = get_connection()
    try:
        order_columns = {info[1] for info in conn.execute("PRAGMA table_info(orders)")}
        order_sort_col = "created_at" if "created_at" in order_columns else "id"
        orders = conn.execute(
            f"SELECT * FROM orders ORDER BY {order_sort_col} DESC"
        ).fetchall()

        order_items = conn.execute(
            "SELECT oi.*, p.name AS product_name, p.stock, p.image_path "
            "FROM order_items oi "
            "LEFT JOIN products p ON p.id = oi.product_id"
        ).fetchall()

        products = conn.execute(
            "SELECT id, name, price, stock, image_path, created_at "
            "FROM products ORDER BY stock ASC, name ASC"
        ).fetchall()
    finally:
        conn.close()

    aggregates = defaultdict(lambda: {"revenue": 0.0, "qty": 0.0})
    for row in order_items:
        order_key = pick_value(row, ["order_id", "orderId", "order", "order_ref"])
        if order_key is None:
            continue
        order_key = str(order_key)
        qty = pick_numeric(row, ["qty", "quantity", "count", "units"], default=0.0) or 0.0
        revenue = pick_numeric(
            row,
            ["line_total", "lineTotal", "total", "total_price"],
            default=None,
        )
        if revenue is None:
            unit_price = pick_numeric(row, ["unit_price", "price", "unitPrice", "amount"], default=0.0)
            revenue = unit_price * qty
        aggregates[order_key]["revenue"] += coerce_float(revenue, default=0.0)
        aggregates[order_key]["qty"] += qty

    daily = defaultdict(lambda: {"revenue": 0.0, "orders": 0, "tax": 0.0})
    weekly = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
    total_revenue = 0.0
    total_orders = 0
    recent_orders = []

    for row in orders:
        created = pick_datetime(row, ["created_at", "createdAt", "created_on", "created"])
        if not created or created < since:
            continue

        order_identifier = pick_value(
            row,
            ["order_id", "order_code", "reference", "uuid", "id"],
        )
        order_key = str(order_identifier) if order_identifier is not None else None
        agg = aggregates.get(order_key) if order_key is not None else None

        revenue = pick_numeric(
            row,
            ["total", "total_price", "grand_total", "amount", "total_amount"],
            default=None,
        )
        if (revenue is None or revenue == 0) and agg:
            revenue = agg["revenue"]
        if revenue is None:
            revenue = 0.0

        if revenue <= 0:
            continue

        tax = pick_numeric(row, ["tax", "tax_amount", "total_tax"], default=0.0) or 0.0

        day_key = created.strftime("%Y-%m-%d")
        year, week_num, _ = created.isocalendar()
        week_key = f"{year}-W{week_num:02d}"

        daily[day_key]["revenue"] += revenue
        daily[day_key]["tax"] += tax
        daily[day_key]["orders"] += 1

        weekly[week_key]["revenue"] += revenue
        weekly[week_key]["orders"] += 1

        total_revenue += revenue
        total_orders += 1

        if len(recent_orders) < 10:
            if order_identifier is None:
                order_identifier = f"order-{len(recent_orders) + 1}"
            recent_orders.append(
                {
                    "order_id": str(order_identifier),
                    "buyer": pick_text(
                        row,
                        ["buyer_username", "username", "email", "customer_name", "name"],
                        default="guest",
                    ),
                    "total": revenue,
                    "created_at": created.isoformat(),
                }
            )

    daily_series = [
        {
            "date": day,
            "revenue": round(values["revenue"], 2),
            "orders": values["orders"],
            "tax": round(values["tax"], 2),
        }
        for day, values in sorted(daily.items(), key=lambda item: item[0])
    ]

    weekly_series = [
        {
            "label": key,
            "revenue": round(values["revenue"], 2),
            "orders": values["orders"],
        }
        for key, values in sorted(weekly.items(), key=lambda item: item[0])[-weekly_window:]
    ]

    top_products_map = defaultdict(
        lambda: {"name": "Unknown product", "units": 0.0, "revenue": 0.0, "stock": None, "image": ""}
    )
    for row in order_items:
        qty = pick_numeric(row, ["qty", "quantity", "count", "units"], default=0.0)
        if qty <= 0:
            continue

        price_basis = pick_numeric(row, ["unit_price", "price", "unitPrice", "amount"], default=0.0)
        revenue = pick_numeric(
            row,
            ["line_total", "lineTotal", "total", "total_price"],
            default=price_basis * qty,
        )

        key = pick_value(row, ["product_id", "productId", "item_id", "id", "name"], default="unknown")
        entry = top_products_map[key]
        entry["name"] = pick_text(
            row,
            ["product_name", "name", "item_name", "title"],
            default=entry["name"],
        )
        entry["units"] += qty
        entry["revenue"] += revenue
        if entry["stock"] is None:
            entry["stock"] = row_get(row, "stock")
        if not entry["image"]:
            entry["image"] = row_get(row, "image_path", default="")

    top_products = sorted(
        (
            {
                "name": entry["name"],
                "units": int(round(entry["units"])),
                "revenue": round(entry["revenue"], 2),
                "stock": entry["stock"],
                "image": entry["image"],
            }
            for entry in top_products_map.values()
        ),
        key=lambda item: item["revenue"],
        reverse=True,
    )[:8]

    low_stock = [
        {
            "id": row_get(row, "id"),
            "name": row_get(row, "name"),
            "stock": row_get(row, "stock"),
            "price": coerce_float(row_get(row, "price"), default=0.0),
            "value": round(
                coerce_float(row_get(row, "price"), default=0.0)
                * coerce_float(row_get(row, "stock"), default=0.0),
                2,
            ),
        }
        for row in products
        if row_get(row, "stock") is not None and row_get(row, "stock") <= low_stock_threshold
    ][:10]

    inventory_value = sum(
        coerce_float(row_get(row, "price"), default=0.0)
        * coerce_float(row_get(row, "stock"), default=0.0)
        for row in products
    )

    return {
        "range_days": range_days,
        "weekly_window": weekly_window,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "totals": {
            "revenue": round(total_revenue, 2),
            "orders": total_orders,
            "avg_order_value": round(total_revenue / total_orders, 2) if total_orders else 0.0,
        },
        "daily": daily_series,
        "weekly": weekly_series,
        "top_products": top_products,
        "low_stock": low_stock,
        "inventory": {
            "total_products": len(products),
            "items_below_threshold": len(low_stock),
            "inventory_value": round(inventory_value, 2),
        },
        "recent_orders": recent_orders,
    }


TEMPLATE_PRODUCTS = '''
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Python製品ページ</title>
    <link rel="stylesheet" href="/static/styles.css">
    <style>
        body { background:#0f111a; color:#f3f4ff; font-family: "Segoe UI", sans-serif; }
        a { color:#9cdcfe; }
        .py-products-section { max-width: 900px; margin: 3rem auto; background: #181a2a; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.25); padding: 2.5rem; color: #fff; }
        .py-products-section h2 { color: #ffd700; margin-bottom: 2rem; }
        .py-products-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 2rem; }
        .py-product-card { background: #23244a; border-radius: 10px; padding: 1.5rem; box-shadow: 0 4px 16px rgba(0,0,0,0.18); text-align: center; }
        .py-product-card img { max-width: 120px; margin-bottom: 1rem; border-radius: 12px; }
        .py-product-card h3 { margin: 0.5rem 0; color: #ffd700; }
        .py-product-card p { color: #cfd8ff; margin-bottom: 0.5rem; min-height: 60px; }
        .py-product-price { font-size: 1.3rem; font-weight: bold; color: #34d399; margin-bottom: 1rem; }
        .py-product-stock { color:#fca5a5; font-weight:600; }
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
                <a href="/python-products/dashboard">分析ダッシュボード</a>
            </div>
        </nav>
    </header>
    <main>
        <section class="py-products-section">
            <h2>Python製品一覧</h2>
            {% if products %}
                <div class="py-products-grid">
                    {% for p in products %}
                    <div class="py-product-card">
                        <img src="{{p.img}}" alt="{{p.name}}">
                        <h3>{{p.name}}</h3>
                        <p>{{p.desc}}</p>
                        <div class="py-product-price">¥{{p.price}}</div>
                        <div class="py-product-stock">在庫: {{p.stock}}</div>
                    </div>
                    {% endfor %}
                </div>
            {% else %}
                <p>商品情報が見つかりませんでした。</p>
            {% endif %}
        </section>
    </main>
    <footer>
        <p>&copy; 2024 Python製品ページ - 教育目的のみ</p>
    </footer>
</body>
</html>
'''


TEMPLATE_DASHBOARD = '''
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Python製品ダッシュボード</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <style>
        body { background:#0b0d16; color:#f8fafc; font-family: "Segoe UI", sans-serif; }
        header, main { max-width: 1200px; margin: 0 auto; }
        .stats-grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap:1.2rem; margin:2rem 0; }
        .card { background:#141b2d; padding:1.4rem; border-radius:16px; box-shadow:0 12px 28px rgba(0,0,0,0.35); border:1px solid rgba(148,163,184,0.12); }
        .card h3 { margin-bottom:0.4rem; font-size:1.1rem; color:#cbd5f5; }
        .metric { font-size:1.8rem; font-weight:600; color:#60a5fa; }
        canvas { background:#0f172a; border-radius:16px; padding:1rem; }
        table { width:100%; border-collapse:collapse; font-size:0.95rem; }
        th, td { padding:0.6rem 0.8rem; border-bottom:1px solid rgba(148,163,184,0.2); }
        th { text-align:left; color:#94a3b8; font-weight:500; }
        .split { display:grid; gap:1.4rem; grid-template-columns: repeat(auto-fit,minmax(320px,1fr)); margin-top:2rem; }
        .muted { color:#94a3b8; font-size:0.85rem; }
        .range-selector { display:flex; gap:0.8rem; flex-wrap:wrap; align-items:center; margin-bottom: 1.2rem; }
        .range-selector button { background:#1f2937; color:#e2e8f0; border-radius:999px; border:1px solid transparent; padding:0.4rem 0.9rem; cursor:pointer; transition:background 0.2s ease; }
        .range-selector button:hover { background:#334155; }
        .range-selector button.active { background:#38bdf8; color:#0b1120; font-weight:600; }
    </style>
</head>
<body>
    <header style="padding:2.4rem 1.4rem 1.2rem;">
        <nav>
            <ul>
                <li><strong>🐍 Python Analytics</strong></li>
            </ul>
            <ul>
                <li><a href="/python-products">商品一覧</a></li>
                <li><a href="http://127.0.0.1:3000/" rel="noopener">Node本体へ戻る</a></li>
            </ul>
        </nav>
        <h1 style="margin-top:1rem;">売上・在庫ダッシュボード</h1>
        <p class="muted">SQLiteに蓄積された注文データを可視化し、日次・週次のトレンドや在庫の偏りを確認できます。</p>
    </header>
    <main style="padding:0 1.4rem 3rem;">
        <section class="range-selector" aria-label="集計期間">
            <span class="muted">集計範囲:</span>
            <button data-days="1">1日</button>
            <button data-days="7">7日</button>
            <button data-days="30" class="active">30日</button>
            <button data-days="90">90日</button>
            <button data-days="180">180日</button>
            <button data-days="365">365日</button>
        </section>

        <section class="stats-grid">
            <article class="card">
                <h3>総売上</h3>
                <div class="metric" id="metricRevenue">¥0</div>
                <p class="muted">対象期間の合計金額</p>
            </article>
            <article class="card">
                <h3>注文数</h3>
                <div class="metric" id="metricOrders">0</div>
                <p class="muted">完了ベースの件数</p>
            </article>
            <article class="card">
                <h3>平均注文単価</h3>
                <div class="metric" id="metricAov">¥0</div>
                <p class="muted">売上 ÷ 件数</p>
            </article>
            <article class="card">
                <h3>在庫評価額</h3>
                <div class="metric" id="metricInventory">¥0</div>
                <p class="muted">現在庫 × 単価の概算</p>
            </article>
        </section>

        <section class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
                <h3>日次売上トレンド</h3>
                <span class="muted" id="dailyRangeLabel"></span>
            </div>
            <div id="dailyHint" class="muted" style="display:none;padding:1.2rem 0.8rem;">過去24時間はリアルタイム集計のみのためトレンドグラフを表示していません。</div>
            <canvas id="dailyChart" height="220"></canvas>
        </section>

        <section class="card" style="margin-top:2rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
                <h3>週次売上・注文件数</h3>
                <span class="muted" id="weeklyRangeLabel"></span>
            </div>
            <div id="weeklyHint" class="muted" style="display:none;padding:1.2rem 0.8rem;">7日未満の範囲では週次トレンドを表示できません。</div>
            <canvas id="weeklyChart" height="220"></canvas>
        </section>

        <section class="split">
            <article class="card">
                <h3>トップ商品</h3>
                <table>
                    <thead>
                        <tr><th>商品</th><th>数量</th><th>売上</th><th>在庫</th></tr>
                    </thead>
                    <tbody id="topProductsBody">
                        <tr><td colspan="4" class="muted">データを読み込み中…</td></tr>
                    </tbody>
                </table>
            </article>
            <article class="card">
                <h3>在庫要注意</h3>
                <table>
                    <thead>
                        <tr><th>商品</th><th>在庫</th><th>評価額</th></tr>
                    </thead>
                    <tbody id="lowStockBody">
                        <tr><td colspan="3" class="muted">データを読み込み中…</td></tr>
                    </tbody>
                </table>
            </article>
        </section>

        <section class="card" style="margin-top:2rem;">
            <h3>直近の注文</h3>
            <table>
                <thead>
                    <tr><th>注文ID</th><th>ユーザー</th><th>合計</th><th>日時</th></tr>
                </thead>
                <tbody id="recentOrdersBody">
                    <tr><td colspan="4" class="muted">データを読み込み中…</td></tr>
                </tbody>
            </table>
        </section>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
    <script>
        const fmtJPY = (value) => '¥' + Number(value || 0).toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const WEEKLY_WINDOW = {{ weekly_window }};
        let dailyChart, weeklyChart;

        async function loadMetrics(days = 30) {
            const res = await fetch(`/python-products/api/metrics?days=${encodeURIComponent(days)}`);
            if (!res.ok) throw new Error('failed to load metrics');
            const data = await res.json();
            updateSummary(data);
            updateDailyChart(data.daily, data.range_days);
            updateWeeklyChart(data.weekly, data.weekly_window, data.range_days);
            updateTables(data);
            document.getElementById('dailyRangeLabel').textContent = `過去 ${data.range_days} 日`;
            document.getElementById('weeklyRangeLabel').textContent = `過去 ${data.weekly_window} 週`;
        }

        function updateSummary(data) {
            document.getElementById('metricRevenue').textContent = fmtJPY(data.totals.revenue);
            document.getElementById('metricOrders').textContent = data.totals.orders.toLocaleString('ja-JP');
            document.getElementById('metricAov').textContent = fmtJPY(data.totals.avg_order_value);
            document.getElementById('metricInventory').textContent = fmtJPY(data.inventory.inventory_value);
        }

        function updateDailyChart(daily, rangeDays) {
            const hint = document.getElementById('dailyHint');
            const canvas = document.getElementById('dailyChart');
            if (rangeDays && Number(rangeDays) <= 1) {
                if (dailyChart) { dailyChart.destroy(); dailyChart = null; }
                if (canvas) canvas.style.display = 'none';
                if (hint) {
                    hint.textContent = '過去24時間はリアルタイム集計のみのためトレンドグラフを表示していません。';
                    hint.style.display = 'block';
                }
                return;
            }
            if (hint) hint.style.display = 'none';
            if (canvas) canvas.style.display = 'block';
            const labels = daily.map((row) => row.date);
            const revenues = daily.map((row) => row.revenue);
            const orders = daily.map((row) => row.orders);
            const ctx = canvas;
            const config = {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            type: 'bar',
                            label: '売上',
                            data: revenues,
                            backgroundColor: 'rgba(56, 189, 248, 0.6)',
                            borderRadius: 6,
                        },
                        {
                            type: 'line',
                            label: '注文数',
                            data: orders,
                            borderColor: '#fcd34d',
                            yAxisID: 'y1',
                            tension: 0.3,
                        }
                    ],
                },
                options: {
                    responsive: true,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { callback: (value) => fmtJPY(value).replace('¥','') }
                        },
                        y1: {
                            beginAtZero: true,
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            ticks: { color: '#fcd34d' }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    return context.dataset.label === '売上'
                                        ? fmtJPY(context.parsed.y)
                                        : `注文数: ${context.parsed.y}`;
                                }
                            }
                        }
                    }
                }
            };
            if (dailyChart) {
                dailyChart.destroy();
            }
            dailyChart = new Chart(ctx, config);
        }

        function updateWeeklyChart(weekly, windowValue, rangeDays) {
            const hint = document.getElementById('weeklyHint');
            const canvas = document.getElementById('weeklyChart');
            if (rangeDays && Number(rangeDays) < 7) {
                if (weeklyChart) { weeklyChart.destroy(); weeklyChart = null; }
                if (canvas) canvas.style.display = 'none';
                if (hint) {
                    hint.textContent = '7日未満の範囲では週次トレンドを表示できません。';
                    hint.style.display = 'block';
                }
                return;
            }
            if (!weekly.length) {
                if (weeklyChart) { weeklyChart.destroy(); weeklyChart = null; }
                if (canvas) canvas.style.display = 'none';
                if (hint) {
                    hint.textContent = '表示できる週間データがありません。';
                    hint.style.display = 'block';
                }
                return;
            }
            if (hint) hint.style.display = 'none';
            if (canvas) canvas.style.display = 'block';
            const labels = weekly.map((row) => row.label);
            const revenues = weekly.map((row) => row.revenue);
            const orders = weekly.map((row) => row.orders);
            const ctx = canvas;
            const config = {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: '週次売上',
                            data: revenues,
                            borderColor: '#34d399',
                            backgroundColor: 'rgba(52, 211, 153, 0.2)',
                            tension: 0.35,
                            fill: true,
                        },
                        {
                            label: '注文件数',
                            data: orders,
                            borderColor: '#f97316',
                            borderDash: [6, 4],
                            yAxisID: 'y1',
                            tension: 0.3,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { callback: (value) => fmtJPY(value).replace('¥','') }
                        },
                        y1: {
                            beginAtZero: true,
                            position: 'right',
                            grid: { drawOnChartArea: false },
                        }
                    }
                }
            };
            if (weeklyChart) {
                weeklyChart.destroy();
            }
            weeklyChart = new Chart(ctx, config);
        }

        function updateTables(data) {
            const topBody = document.getElementById('topProductsBody');
            const lowBody = document.getElementById('lowStockBody');
            const recentBody = document.getElementById('recentOrdersBody');

            topBody.innerHTML = data.top_products.length
                ? data.top_products.map((item) => `<tr>
                        <td>${item.name}</td>
                        <td>${item.units.toLocaleString('ja-JP')}</td>
                        <td>${fmtJPY(item.revenue)}</td>
                        <td>${item.stock ?? '-'}</td>
                    </tr>`).join('')
                : `<tr><td colspan="4" class="muted">データがありません。</td></tr>`;

            lowBody.innerHTML = data.low_stock.length
                ? data.low_stock.map((item) => `<tr>
                        <td>${item.name}</td>
                        <td>${item.stock}</td>
                        <td>${fmtJPY(item.value)}</td>
                    </tr>`).join('')
                : `<tr><td colspan="3" class="muted">在庫が閾値を上回っています。</td></tr>`;

            recentBody.innerHTML = data.recent_orders.length
                ? data.recent_orders.map((item) => `<tr>
                        <td>${item.order_id}</td>
                        <td>${item.buyer}</td>
                        <td>${fmtJPY(item.total)}</td>
                        <td>${new Date(item.created_at).toLocaleString('ja-JP')}</td>
                    </tr>`).join('')
                : `<tr><td colspan="4" class="muted">最近の注文がありません。</td></tr>`;
        }

        document.querySelectorAll('.range-selector button').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                document.querySelectorAll('.range-selector button').forEach(b => b.classList.remove('active'));
                event.currentTarget.classList.add('active');
                const days = Number(event.currentTarget.dataset.days);
                loadMetrics(days).catch((err) => {
                    console.error(err);
                    alert('ダッシュボードの読み込みに失敗しました。');
                });
            });
        });

        loadMetrics(30).catch((err) => {
            console.error(err);
            alert('ダッシュボードの読み込みに失敗しました。');
        });
    </script>
</body>
</html>
'''


@app.route("/python-products")
def python_products():
    products = fetch_products()
    return render_template_string(TEMPLATE_PRODUCTS, products=products)

@app.route("/python-products/dashboard")
def python_dashboard():
    return render_template_string(TEMPLATE_DASHBOARD, weekly_window=DEFAULT_WEEKLY_WINDOW)


@app.get("/python-products/api/metrics")
def python_metrics():
    days = request.args.get("days", "30")
    try:
        metrics = gather_metrics(range_days=int(days))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500
    return jsonify(metrics)

@app.route("/")
def root_redirect():
    return redirect("http://127.0.0.1:3000/")


if __name__ == "__main__":
    app.run()
