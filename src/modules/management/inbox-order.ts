/** SQLite's ORDER BY over values D1 returns, so a candidate set read once (one row each) is ordered exactly as
 * `ORDER BY` would order it; sorting in SQL reads every sorted row a second time. NULL sorts first, then numbers
 * (integer and real compare by value), then text (BINARY: UTF-8 bytes, which is code point order), then blobs. */
type Value=null|number|string|ArrayBuffer|Uint8Array|number[]
const rank=(value:Value)=>value===null||value===undefined?0:typeof value==='number'?1:typeof value==='string'?2:3
function codePoints(x:string,y:string){
 for(let i=0,j=0;i<x.length&&j<y.length;){
  const a=x.codePointAt(i)!,b=y.codePointAt(j)!
  if(a!==b)return a<b?-1:1
  i+=a>0xffff?2:1;j+=b>0xffff?2:1
 }
 return x.length===y.length?0:x.length<y.length?-1:1
}
const bytes=(value:Value)=>value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):Uint8Array.from(value as number[])
export function compareValues(x:Value,y:Value){
 const a=rank(x),b=rank(y)
 if(a!==b)return a<b?-1:1
 if(a===0)return 0
 if(a===1)return (x as number)<(y as number)?-1:(x as number)>(y as number)?1:0
 if(a===2)return codePoints(x as string,y as string)
 const p=bytes(x),q=bytes(y)
 for(let i=0;i<Math.min(p.length,q.length);i++)if(p[i]!==q[i])return p[i]<q[i]?-1:1
 return p.length===q.length?0:p.length<q.length?-1:1
}
/** A number D1 returned exactly: an integer beyond 2^53 may have lost its value, so such a set is sorted by SQL. */
export const exact=(value:unknown)=>typeof value!=='number'||Number.isSafeInteger(value)||!Number.isInteger(value)
/** Orders rows by their keys k0..kn (each ascending or descending), the last of them the conversation id. */
export function sortRows<T extends Record<string,unknown>>(rows:T[],directions:('asc'|'desc')[]){
 return rows.sort((x,y)=>{
  for(let i=0;i<directions.length;i++){
   const order=compareValues(x['k'+i] as Value,y['k'+i] as Value)
   if(order)return directions[i]==='asc'?order:-order
  }
  return 0
 })
}
