import json
import urllib.request
import http.cookiejar
import urllib.parse
import os

BASE_URL = os.getenv("SHOP_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
USERNAME = os.getenv("SHOP_USERNAME", "CHECK-MARX")
PASSWORD = os.getenv("SHOP_PASSWORD")

if not PASSWORD:
    raise SystemExit("Set SHOP_PASSWORD before running this script.")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

login_data = json.dumps({"username": USERNAME, "password": PASSWORD}).encode()
req = urllib.request.Request(
    f"{BASE_URL}/api/login",
    data=login_data,
    headers={"Content-Type": "application/json"},
)
res = opener.open(req)
print('login status', res.status)
print('cookies', [(c.name, c.value) for c in cj])

payload = json.dumps({"items":[{"productId":1,"qty":1}],"cardLast4":"4242","name":"Tester"}).encode()
req2 = urllib.request.Request(
    f"{BASE_URL}/api/checkout",
    data=payload,
    headers={"Content-Type": "application/json"},
)
try:
    res2 = opener.open(req2)
    print('checkout status', res2.status)
    print(res2.read().decode())
except urllib.error.HTTPError as e:
    print('checkout error', e.code, e.reason)
    print(e.read().decode())
