'use strict';
const {Pool}=require('pg');

function poolFromEnvironment(env=process.env) {
  if(!env.DATABASE_URL) throw new Error('DATABASE_URL is required: API will not use ephemeral disk or localStorage');
  return new Pool({connectionString:env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,statement_timeout:12000,
    ssl:env.PGSSLMODE==='require'?{rejectUnauthorized:true}:undefined});
}
async function schema(pool) {
  const ddl=[
    'CREATE TABLE IF NOT EXISTS api_state (id INTEGER PRIMARY KEY CHECK(id=1), initialized BOOLEAN NOT NULL DEFAULT FALSE, import_checksum TEXT, source_revision TEXT, imported_at TIMESTAMPTZ)',
    'INSERT INTO api_state(id) VALUES (1) ON CONFLICT(id) DO NOTHING',
    'CREATE TABLE IF NOT EXISTS orders (id UUID PRIMARY KEY, legacy_id TEXT UNIQUE, invoice_no BIGINT, order_date DATE, customer_search TEXT NOT NULL, phone_search TEXT NOT NULL, status TEXT NOT NULL, total NUMERIC(18,2) NOT NULL, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    'CREATE INDEX IF NOT EXISTS ix_orders_date ON orders(order_date DESC)',
    'CREATE INDEX IF NOT EXISTS ix_orders_customer ON orders(customer_search)',
    'CREATE INDEX IF NOT EXISTS ix_orders_phone ON orders(phone_search)',
    'CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status)',
    'CREATE TABLE IF NOT EXISTS import_backups (checksum TEXT PRIMARY KEY, snapshot JSONB NOT NULL, source_revision TEXT, actor TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    'CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, order_id UUID, before_state JSONB, after_state JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    'CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at DESC)',
    'CREATE TABLE IF NOT EXISTS write_receipts (actor TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, response JSONB NOT NULL, status INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(actor,idem_key))'
  ];
  for(const sql of ddl) await pool.query(sql);
}
async function transaction(pool, action) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const out=await action(client);
    await client.query('COMMIT');
    return out;
  }catch(e) {
    try{await client.query('ROLLBACK');}catch{}
    throw e;
  }finally{client.release();}
}
module.exports={poolFromEnvironment,schema,transaction};
