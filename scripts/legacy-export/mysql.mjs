import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';

export const identifier = value => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw Error('Unsafe SQL identifier');
  return '`' + value + '`';
};
export async function connectLegacy(env = process.env) {
  for (const name of ['LEGACY_MYSQL_HOST','LEGACY_MYSQL_DATABASE','LEGACY_MYSQL_USER','LEGACY_MYSQL_PASSWORD'])
    if (env[name] === undefined || env[name] === '') throw Error(`Set ${name} explicitly`);
  const port = Number(env.LEGACY_MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid LEGACY_MYSQL_PORT');
  const connection=await mysql.createConnection({
    host: env.LEGACY_MYSQL_HOST, port, database: env.LEGACY_MYSQL_DATABASE,
    user: env.LEGACY_MYSQL_USER, password: env.LEGACY_MYSQL_PASSWORD,
    ...(env.LEGACY_MYSQL_SSL_CA ? {ssl: {ca: await readFile(env.LEGACY_MYSQL_SSL_CA), rejectUnauthorized: true}} : {}),
    charset: 'utf8mb4', timezone: 'Z', dateStrings: true,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, jsonStrings: true,
    multipleStatements: false, connectTimeout: 15000,
  });
  if(env.LEGACY_MYSQL_EXPECTED_SERVER_PREFIX){
    const [[server]]=await connection.query('SELECT @@aurora_server_id AS id');
    if(!String(server.id).startsWith(env.LEGACY_MYSQL_EXPECTED_SERVER_PREFIX)){await connection.end();throw Error('Refusing unexpected source server');}
  }
  return connection;
}
// A table whose primary key is exactly `id` is read in id-ordered pages inside the open
// snapshot, so only one page is ever in flight. Streaming a whole large table at once lets the
// server outrun a slow link; an SSM port-forward then buffers it and wedges (seen on a production-sized dry run).
export const pageRows=10000;
export async function* selectRows(connection,{table,columns,where,args,orderBy,keyed}){
  const from=`SELECT ${columns.map(identifier).join(',')} FROM ${identifier(table)} WHERE `;
  if(!keyed){yield* connection.connection.query({sql:from+where+(orderBy?` ORDER BY ${orderBy}`:''),values:args}).stream({highWaterMark:16});return;}
  if(!columns.includes('id'))throw Error(`Paged read needs its key column: ${table}`);
  const key=`${identifier(table)}.${identifier('id')}`;
  for(let after=null;;){
    const [rows]=await connection.query({sql:`${from}(${where})${after===null?'':` AND ${key}>?`} ORDER BY ${key} LIMIT ${pageRows}`,values:after===null?args:[...args,after]});
    yield* rows;if(rows.length<pageRows)return;after=rows.at(-1).id;
  }
}
// SELECTs and transaction/session control only. No locks or source mutations.
export async function snapshot(connection, read) {
  await connection.query("SET SESSION time_zone = '+00:00'");
  await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try { const result = await read(); await connection.query('COMMIT'); return result; }
  catch (error) { connection.destroy(); throw error; }
}
