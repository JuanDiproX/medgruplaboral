// Levanta el portal completo en local con una base PostgreSQL embebida (PGlite) y sin servicios
// externos. Solo para desarrollo y pruebas con datos ficticios: nunca toca producción.
//   node scripts/dev-local.cjs            -> http://localhost:3000
const Module = require('module');
const path = require('path');
const {PGlite} = require('@electric-sql/pglite');
const dataDir = process.env.DEV_DB_DIR || undefined; // sin carpeta: base en memoria
const db = new PGlite(dataDir);
let chain = Promise.resolve();
const run = (sql, params) => {
  const job = chain.then(() => (!params || !params.length) && /;\s*\S/.test(sql)
    ? db.exec(sql).then(r => r[r.length - 1] || {rows: []})
    : db.query(sql, (params || []).map(v => v === undefined ? null : v)));
  chain = job.catch(() => {});
  return job.then(r => ({rows: r.rows || [], rowCount: r.affectedRows ?? (r.rows || []).length}));
};
const client = {query: run, release() {}};
function Pool() { return {on() {}, query: run, connect: async () => client, end: async () => db.close()}; }
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'pg' ? {Pool} : load.call(this, request, ...rest); };
process.env.SESSION_SECRET ||= 'solo-desarrollo-local-no-usar-en-produccion';
process.env.PARTICIPANT_ACCESS_SECRET ||= 'solo-desarrollo-local-accesos';
process.env.PORT ||= '3000';
process.env.DEV_LOCAL = '1';
require(path.join(__dirname, '..', 'server.js'));
if (process.env.DEV_SEED !== '0') setTimeout(() => require('./dev-seed.cjs')(run).catch(e => console.error('seed', e.message)), 2500);
