import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const mimes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to read file');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimes.get(path.extname(file)) || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(data);
  });
}

function proxyApi(req, res) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 8000,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    upstreamRes => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Backend proxy error: ${err.message}`);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }

  const cleanUrl = decodeURIComponent(url.split('?')[0]);
  const requested = path.normalize(path.join(dist, cleanUrl));
  if (!requested.startsWith(path.normalize(dist))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(requested, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, requested);
      return;
    }
    if (!err && stat.isDirectory()) {
      sendFile(res, path.join(requested, 'index.html'));
      return;
    }
    sendFile(res, path.join(dist, 'index.html'));
  });
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Static frontend listening on http://127.0.0.1:3000');
});
