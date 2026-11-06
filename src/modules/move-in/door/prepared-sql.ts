import type {Env} from '../../../platform/env'
import type {D1Sql} from '../../import-kit/src/d1/types'
/** Preserve the existing native SQL builders and reads, while supplying their
 * exact statements to Base's atomic erasure transaction. */
export function preparedSql(env:Env){
 const statements=new WeakMap<object,{raw:D1PreparedStatement;query:D1Sql}>()
 const track=(raw:D1PreparedStatement,query:D1Sql):D1PreparedStatement=>{
  const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return (...params:any[])=>track(target.bind(...params),{sql:query.sql,params});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
  statements.set(proxy,{raw,query});return proxy
 }
 const db=new Proxy(env.DB,{get(target,key){if(key==='prepare')return (sql:string)=>track(target.prepare(sql),{sql,params:[]});if(key==='batch')return (rows:D1PreparedStatement[])=>target.batch(rows.map(row=>statements.get(row)?.raw??row));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
 return {env:{...env,DB:db},raw(rows:D1PreparedStatement[]){return rows.map(row=>statements.get(row)?.raw??row)},queries(rows:D1PreparedStatement[]){return rows.map(row=>{const found=statements.get(row);if(!found)throw new Error('import_native_statement_untracked');return found.query})}}
}
