const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { URL } = require('url');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePath(routePath) {
  const keys = [];
  if (routePath === '/') return { regex: /^\/?$/, keys };
  const src = '^' + String(routePath)
    .split('/')
    .map((seg) => {
      if (!seg) return '';
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return escapeRegex(seg);
    })
    .join('/') + '/?$';
  return { regex: new RegExp(src), keys };
}

function addSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  const list = Array.isArray(prev) ? prev.slice() : [String(prev)];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}

function toCookieString(name, value, opts = {}) {
  let out = `${name}=${encodeURIComponent(String(value ?? ''))}`;
  const p = opts.path || '/';
  out += `; Path=${p}`;
  if (opts.maxAge !== undefined && opts.maxAge !== null) {
    out += `; Max-Age=${Math.max(0, Math.floor(Number(opts.maxAge) / 1000))}`;
  }
  if (opts.expires) out += `; Expires=${new Date(opts.expires).toUTCString()}`;
  if (opts.httpOnly) out += '; HttpOnly';
  if (opts.secure) out += '; Secure';
  if (opts.sameSite) out += `; SameSite=${opts.sameSite}`;
  return out;
}

function patchResponse(res) {
  if (res._tinyPatched) return res;
  res._tinyPatched = true;

  res.status = function status(code) {
    res.statusCode = Number(code) || 200;
    return res;
  };

  res.json = function json(obj) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    if (!res.writableEnded) res.end(JSON.stringify(obj));
    return res;
  };

  res.send = function send(body) {
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
      if (!res.writableEnded) res.end(body);
      return res;
    }
    const text = String(body ?? '');
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (!res.writableEnded) res.end(text);
    return res;
  };

  res.sendFile = function sendFile(filePath) {
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        if (!res.writableEnded) res.status(404).end();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      }
      const rs = fs.createReadStream(filePath);
      rs.on('error', () => { if (!res.writableEnded) res.status(500).end(); });
      rs.pipe(res);
    });
    return res;
  };

  res.cookie = function cookie(name, value, opts) {
    addSetCookie(res, toCookieString(name, value, opts));
    return res;
  };

  res.clearCookie = function clearCookie(name, opts = {}) {
    addSetCookie(res, toCookieString(name, '', { ...opts, maxAge: 0, expires: new Date(0) }));
    return res;
  };

  return res;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req._bodyParsed) return resolve();
    req._bodyParsed = true;

    const method = String(req.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      req.body = {};
      return resolve();
    }

    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    const chunks = [];
    let size = 0;
    const max = 5 * 1024 * 1024;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        req.body = {};
        return resolve();
      }
      try {
        if (ctype.includes('application/json')) req.body = JSON.parse(raw);
        else if (ctype.includes('application/x-www-form-urlencoded')) req.body = querystring.parse(raw);
        else req.body = {};
        return resolve();
      } catch (e) {
        return reject(e);
      }
    });
    req.on('error', reject);
  });
}

function prefixMatch(pathname, prefix) {
  if (!prefix || prefix === '/') return true;
  if (pathname === prefix) return true;
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return pathname.startsWith(p);
}

function runHandler(fn, args, onErr) {
  try {
    const ret = fn(...args);
    if (ret && typeof ret.then === 'function') ret.catch(onErr);
  } catch (e) {
    onErr(e);
  }
}

function createApp() {
  const stack = [];

  function addRoute(method, routePath, handlers) {
    const { regex, keys } = compilePath(routePath);
    stack.push({ type: 'route', method, routePath, regex, keys, handlers });
  }

  const app = {
    use(prefixOrFn, ...handlers) {
      let prefix = '/';
      let fns = handlers;
      if (typeof prefixOrFn === 'function') fns = [prefixOrFn, ...handlers];
      else prefix = String(prefixOrFn || '/');
      for (const fn of fns) {
        if (typeof fn !== 'function') continue;
        stack.push({ type: 'mw', prefix, fn, isError: fn.length === 4 });
      }
      return app;
    },
    get(routePath, ...handlers) { addRoute('GET', routePath, handlers); return app; },
    post(routePath, ...handlers) { addRoute('POST', routePath, handlers); return app; },
    put(routePath, ...handlers) { addRoute('PUT', routePath, handlers); return app; },
    patch(routePath, ...handlers) { addRoute('PATCH', routePath, handlers); return app; },
    delete(routePath, ...handlers) { addRoute('DELETE', routePath, handlers); return app; },
    listen(port, host, cb) {
      const server = http.createServer(async (req, res) => {
        patchResponse(res);
        req.params = {};
        req.query = {};
        try {
          const base = `http://${req.headers.host || 'localhost'}`;
          const u = new URL(req.url || '/', base);
          req.path = decodeURIComponent(u.pathname);
          for (const [k, v] of u.searchParams.entries()) req.query[k] = v;
          await parseBody(req);
        } catch {
          if (!res.writableEnded) res.status(400).json({ error: 'bad_request' });
          return;
        }

        let idx = 0;
        let routeFound = false;

        const done = (err) => {
          if (res.writableEnded) return;
          if (err) return res.status(500).json({ error: 'server_error' });
          if (!routeFound) return res.status(404).json({ error: 'not_found' });
        };

        const runRouteHandlers = (handlers, params, nextRoute, err) => {
          let hi = 0;
          req.params = params;
          const next = (nextErr) => {
            if (res.writableEnded) return;
            const h = handlers[hi++];
            if (!h) return nextRoute(nextErr);
            if (nextErr) {
              if (h.length === 4) return runHandler(h, [nextErr, req, res, next], next);
              return next(nextErr);
            }
            if (h.length >= 3) return runHandler(h, [req, res, next], next);
            return runHandler(h, [req, res], next);
          };
          next(err);
        };

        const dispatch = (err) => {
          if (res.writableEnded) return;
          const layer = stack[idx++];
          if (!layer) return done(err);

          if (layer.type === 'mw') {
            if (!prefixMatch(req.path, layer.prefix)) return dispatch(err);
            if (err) {
              if (!layer.isError) return dispatch(err);
              return runHandler(layer.fn, [err, req, res, dispatch], dispatch);
            }
            if (layer.isError) return dispatch();
            return runHandler(layer.fn, [req, res, dispatch], dispatch);
          }

          if (err) return dispatch(err);
          if (layer.method !== req.method) return dispatch();
          const m = req.path.match(layer.regex);
          if (!m) return dispatch();
          routeFound = true;
          const params = {};
          for (let i = 0; i < layer.keys.length; i++) {
            try { params[layer.keys[i]] = decodeURIComponent(m[i + 1]); }
            catch { params[layer.keys[i]] = m[i + 1]; }
          }
          return runRouteHandlers(layer.handlers, params, dispatch);
        };

        dispatch();
      });
      return server.listen(port, host, cb);
    }
  };

  return app;
}

function express() {
  return createApp();
}

express.json = () => (_req, _res, next) => next();
express.urlencoded = () => (_req, _res, next) => next();
express.static = (rootDir) => {
  const root = path.resolve(String(rootDir || '.'));
  return async (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return next();
    let rel = req.path || '/';
    if (rel === '/') return next();
    rel = rel.replace(/^\/+/, '');
    const target = path.resolve(root, rel);
    if (!target.startsWith(root)) return next();
    try {
      const st = await fs.promises.stat(target);
      if (!st.isFile()) return next();
      return res.sendFile(target);
    } catch {
      return next();
    }
  };
};

module.exports = express;
