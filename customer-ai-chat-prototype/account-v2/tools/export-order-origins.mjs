// Run with a SELECT-only role. Output contains attribution only, no credentials.
import pg from 'pg';
import {readVerifiedOrderOrigins} from '../order-origins.mjs';
const connectionString=process.env.SATORI_V2_ORIGINS_READONLY_DATABASE_URL;
if(!connectionString)throw Error('READONLY_DATABASE_URL_REQUIRED');
const pool=new pg.Pool({connectionString,max:1,connectionTimeoutMillis:5000,
 options:'-c default_transaction_read_only=on'});
try{process.stdout.write(JSON.stringify(await readVerifiedOrderOrigins(pool))+'\n')}
catch{process.stderr.write('ORDER_ORIGINS_EXPORT_FAILED\n');process.exitCode=1}
finally{await pool.end()}
