/** Test-only observation of real D1 SQL and returned row counts, never values. */
export function auditDatabase(db:D1Database){
 const reads:{sql:string;rows:number;bytes:number;rowsRead:number}[]=[],transactions:{sql:string;rowsRead:number;rowsWritten:number;error?:string}[]=[],raw=new WeakMap<object,D1PreparedStatement>(),queries=new WeakMap<object,string>()
 function wrap(statement:D1PreparedStatement,sql:string):D1PreparedStatement{
  const record=(value:any)=>{reads.push({sql,rows:Array.isArray(value?.results)?value.results.length:value==null?0:1,bytes:JSON.stringify(value??null).length,rowsRead:Number(value?.meta?.rows_read??0)});return value}
  const wrapped={bind(...args:any[]){return wrap(statement.bind(...args),sql)},async first(...args:any[]){return record(await (statement.first as any)(...args))},async all(){return record(await statement.all())},run:()=>statement.run(),raw:(...args:any[])=>(statement.raw as any)(...args)} as D1PreparedStatement;raw.set(wrapped,statement);queries.set(wrapped,sql);return wrapped
 }
 return {reads,transactions,database:{prepare(sql:string){return wrap(db.prepare(sql),sql)},async batch(statements:D1PreparedStatement[]){let results:D1Result[];try{results=await db.batch(statements.map(statement=>raw.get(statement)??statement))}catch(error){transactions.push({sql:statements.map(statement=>queries.get(statement)??'').join('\n'),rowsRead:0,rowsWritten:0,error:error instanceof Error?error.message:'D1 batch failed'});throw error}results.forEach((result,index)=>transactions.push({sql:queries.get(statements[index])??'',rowsRead:Number(result.meta.rows_read),rowsWritten:Number(result.meta.rows_written)}));return results},exec:db.exec.bind(db),dump:db.dump.bind(db)} as D1Database}
}
