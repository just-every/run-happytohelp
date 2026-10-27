/** UTF-8 byte length without encoding a copy. In Workers Buffer.byteLength
 * encodes the whole string, so metering every bound plan and row would copy it. */
export function utf8Length(text:string){let bytes=text.length;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code<0x80)continue;if(code<0x800){bytes++;continue}if(code>=0xd800&&code<=0xdbff&&i+1<text.length&&(text.charCodeAt(i+1)&0xfc00)===0xdc00)i++;bytes+=2}return bytes}
/** Workers Paid D1 limits, shared by every operation in one invocation. Work stops
 * `reserve` statements short of the limit; the reserve opens once that happens, so the
 * handler can still record why it stopped instead of failing silently. */
export function boundedDatabase(db:D1Database,limit=1000,reserve=0){
 const metrics={statements:0,writes:0,maxSqlBytes:0,maxBindings:0,maxValueBytes:0,maxParameterBytes:0,maxDurationMs:0},raw=new WeakMap<object,D1PreparedStatement>(),queries=new WeakMap<object,string>()
 let ceiling=limit-reserve
 const consume=(count:number)=>{if(metrics.statements+count>ceiling){ceiling=limit;throw new Error('WORKER_D1_STATEMENT_LIMIT')}metrics.statements+=count}
 const readOnly=(sql:string)=>/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)
 function check(sql:string,params:unknown[]=[]){const sqlBytes=utf8Length(sql),sizes=params.map(value=>typeof value==='string'?utf8Length(value):value instanceof ArrayBuffer||ArrayBuffer.isView(value)?value.byteLength:8),maxValue=Math.max(0,...sizes),total=sizes.reduce((n,size)=>n+size,0);if(sqlBytes>100000||params.length>100)throw new Error('WORKER_D1_QUERY_LIMIT');if(maxValue>2000000||total>2000000)throw new Error('WORKER_D1_VALUE_LIMIT');metrics.maxSqlBytes=Math.max(metrics.maxSqlBytes,sqlBytes);metrics.maxBindings=Math.max(metrics.maxBindings,params.length);metrics.maxValueBytes=Math.max(metrics.maxValueBytes,maxValue);metrics.maxParameterBytes=Math.max(metrics.maxParameterBytes,total)}
 async function measured<T>(run:()=>Promise<T>){const start=performance.now();try{return await run()}finally{metrics.maxDurationMs=Math.max(metrics.maxDurationMs,performance.now()-start)}}
 function wrap(statement:D1PreparedStatement,query:string,params:unknown[]=[]):D1PreparedStatement{
  check(query,params)
  const execute=<T>(run:()=>Promise<T>)=>{consume(1);if(!readOnly(query))metrics.writes++;return measured(run)}
  const result={bind(...values:unknown[]){return wrap(statement.bind(...values),query,values)},first(...args:any[]){return execute(()=>(statement.first as any)(...args))},all(){return execute(()=>statement.all())},run(){return execute(()=>statement.run())},raw(...args:any[]){return execute(()=>(statement.raw as any)(...args))}} as D1PreparedStatement
  raw.set(result,statement);queries.set(result,query);return result
 }
 const instrument=(input:D1Database):D1Database=>{
  const rebase=(input as any)[Symbol.for('happytohelp.d1.layer')]
  if(rebase)return rebase(instrument)
  return {prepare(sql:string){return wrap(input.prepare(sql),sql)},async batch(statements:D1PreparedStatement[]){consume(statements.length);metrics.writes+=statements.filter(s=>!readOnly(queries.get(s)||'')).length;return measured(()=>input.batch(statements.map(s=>raw.get(s)??s)))},async exec(){throw new Error('Unbounded D1 exec is unavailable in request handlers')},dump:()=>input.dump()} as unknown as D1Database
 }
 const database=instrument(db)
 return {database,get metrics(){return {...metrics}},get statements(){return metrics.statements},get writes(){return metrics.writes}}
}
