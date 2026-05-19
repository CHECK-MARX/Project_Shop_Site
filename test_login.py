import http.cookiejar
import json
import os
import urllib.request

BASE_URL = os.getenv("SHOP_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
USERNAME = os.getenv("SHOP_USERNAME", "CHECK-MARX")
PASSWORD = os.getenv("SHOP_PASSWORD")

if not PASSWORD:
    raise SystemExit("Set SHOP_PASSWORD before running this script.")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    f"{BASE_URL}/api/login",
    data=json.dumps({"username": USERNAME, "password": PASSWORD}).encode(),
    headers={"Content-Type": "application/json"},
)
res = opener.open(req)
print('status', res.status)
print('headers', res.getheaders())
print('cookies', [(c.name, c.value) for c in cj])

