#!/usr/bin/env bash
set -euo pipefail
# Always disposable, localhost only. Never reads an external connection string.
export SATORI_V2_CI_DATABASE_URL='postgresql://satori_ci:synthetic_only_local@127.0.0.1:5432/satori_v2_ci'
pg_ver=$(ls /usr/lib/postgresql | sort -V | tail -1)
synthetic_pg_dir=$(mktemp -d /tmp/satori-synthetic-pg.XXXXXX)
chown postgres:postgres "$synthetic_pg_dir"
runuser -u postgres -- /usr/lib/postgresql/"$pg_ver"/bin/initdb -D "$synthetic_pg_dir" -A trust >/dev/null
runuser -u postgres -- /usr/lib/postgresql/"$pg_ver"/bin/pg_ctl -D "$synthetic_pg_dir" -o '-h 127.0.0.1 -p 5432 -c shared_buffers=16MB -c max_connections=20' -l "$synthetic_pg_dir/server.log" start >/dev/null
runuser -u postgres -- psql -h 127.0.0.1 -c "CREATE ROLE satori_ci LOGIN PASSWORD 'synthetic_only_local';" >/dev/null
runuser -u postgres -- createdb -h 127.0.0.1 -O satori_ci satori_v2_ci
cd /app/customer-ai-chat-prototype
SATORI_ACCOUNT_V2_MIGRATION_APPROVED=1 SATORI_ACCOUNT_V2_DATABASE_URL="$SATORI_V2_CI_DATABASE_URL" node account-v2/migrate.mjs
SATORI_ACCOUNT_V2_MIGRATION_APPROVED=1 SATORI_ACCOUNT_V2_DATABASE_URL="$SATORI_V2_CI_DATABASE_URL" node account-v2/migrate.mjs
node --test --test-concurrency=2 account-v2/tests/*.test.mjs
SATORI_BOTAPI_SOURCE=/app/apps-script/production-snapshot-20261115/BotApi.gs node account-v2/tests/grok-orders-ledger.mjs
node account-v2/tests/grok-owner-writes-postgres.mjs
node account-v2/tests/grok-mcp-postgres.mjs
# Tests may insert fixtures into request/outbox tables; reset before the playground.
node --input-type=module -e 'import pg from "pg";const p=new pg.Pool({connectionString:process.env.SATORI_V2_CI_DATABASE_URL});for(const {tablename} of (await p.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE '\''satori_v2_%'\''")).rows)await p.query(`TRUNCATE "${tablename}" CASCADE`);await p.end();'
exec node account-v2/staging/server.mjs
