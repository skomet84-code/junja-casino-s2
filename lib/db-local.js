'use strict';
// TEST ONLY: runs queries through the local psql client against a local Postgres.
const { execFile } = require('node:child_process');
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw Error('bad number'); return String(v); }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false, quoted = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') { q = true; quoted = true; }
    else if (c === ',') { row.push(quoted || f !== '' ? f : null); f = ''; quoted = false; }
    else if (c === '\n') { row.push(quoted || f !== '' ? f : null); rows.push(row); row = []; f = ''; quoted = false; }
    else f += c;
    i++;
  }
  if (f !== '' || row.length) { row.push(quoted || f !== '' ? f : null); rows.push(row); }
  return rows;
}
function q(text, params = []) {
  const sql = text.replace(/\$(\d+)(::\w+)?/g, (m, n, cast) => lit(params[+n - 1]) + (cast || ''));
  return new Promise((res, rej) => {
    execFile('psql', ['-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-d', process.env.LOCAL_PSQL, '-c', sql], { maxBuffer: 1 << 24 }, (err, out, errout) => {
      if (err) return rej(Error((errout || err.message).trim() + ' :: ' + sql.slice(0, 200)));
      const rows = parseCSV(out); if (!rows.length) return res([]);
      const head = rows.shift();
      res(rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))));
    });
  });
}
module.exports = { q };
