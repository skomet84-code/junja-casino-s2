process.env.LOCAL_PSQL = process.env.LOCAL_PSQL || 'casino';
process.env.ADMIN_CODE = process.env.ADMIN_CODE || 'test-admin-code';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const api = require('../api/index.js');
const pub = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; if (p === '/admin') p = '/admin.html';
  const f = path.join(pub, p);
  if (!f.startsWith(pub) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
}).listen(+process.env.PORT || 4321, () => console.log('up'));
