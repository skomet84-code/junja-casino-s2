'use strict';
// Database access. Production: Neon serverless HTTP driver. Tests: local psql shim.
let impl = null;
function get() {
  if (impl) return impl;
  if (process.env.LOCAL_PSQL) impl = require('./db-local');
  else {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    impl = { q: (text, params) => sql.query(text, params) };
  }
  return impl;
}
async function q(text, params = []) {
  const r = await get().q(text, params);
  return Array.isArray(r) ? r : (r && r.rows) || [];
}
async function one(text, params) { return (await q(text, params))[0] || null; }
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v);
module.exports = { q, one, num };
