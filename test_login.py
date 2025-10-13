import json, urllib.request, http.cookiejar
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request('http://127.0.0.1:3000/api/login', data=json.dumps({'username':'CHECK-MARX','password':'test'}).encode(), headers={'Content-Type':'application/json'})
res = opener.open(req)
print('status', res.status)
print('headers', res.getheaders())
print('cookies', [(c.name, c.value) for c in cj])

