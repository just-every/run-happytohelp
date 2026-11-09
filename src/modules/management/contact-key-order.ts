/** SQLite's own order for the contacts list's keys, so a page of a few thousand matches is ordered here exactly as
 * `ORDER BY <key> <direction>,id ASC` orders it: an integer key (last seen) numerically, a text key in NOCASE (ASCII
 * letters folded byte by byte, the comparison stopping at a NUL in the first key, then the shorter first), and the id
 * in BINARY (UTF-8 bytes, then the shorter first). A key of another type is not ordered here (`orderable` is false). */
export type Keyed={id:string;type:string;key:string}
type Sortable={id:Uint8Array;key:bigint|Uint8Array}
const utf8=new TextEncoder()
const fold=(byte:number)=>byte>=65&&byte<=90?byte+32:byte
function nocase(a:Uint8Array,b:Uint8Array){
 let n=Math.min(a.length,b.length),i=0
 while(n-->0&&a[i]!==0&&fold(a[i])===fold(b[i]))i++
 return (n<0?0:fold(a[i])-fold(b[i]))||a.length-b.length
}
function binary(a:Uint8Array,b:Uint8Array){
 for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i]
 return a.length-b.length
}
export const orderable=(rows:Keyed[],integer:boolean)=>rows.every(row=>row.type===(integer?'integer':'text'))
const sortable=(row:Keyed,integer:boolean):Sortable=>({id:utf8.encode(row.id),key:integer?BigInt(row.key):utf8.encode(row.key)})
/** Compares (key,id) pairs in the list's order: the key in its direction, then the id ascending. */
export function keyOrder(integer:boolean,direction:string){
 const sign=direction==='desc'?-1:1
 const keys=(a:Sortable,b:Sortable)=>integer?((a.key as bigint)<(b.key as bigint)?-1:(a.key as bigint)>(b.key as bigint)?1:0):Math.sign(nocase(a.key as Uint8Array,b.key as Uint8Array))
 const compare=(a:Sortable,b:Sortable)=>sign*keys(a,b)||Math.sign(binary(a.id,b.id))
 return {
  /** Below zero when `a` comes before `b` in the list's order. */
  compare:(a:Keyed,b:Keyed)=>compare(sortable(a,integer),sortable(b,integer)),
  /** The rows in the list's order. */
  sort:(rows:Keyed[])=>rows.map(row=>({row,at:sortable(row,integer)})).sort((a,b)=>compare(a.at,b.at)).map(entry=>entry.row),
  /** The number of ordered rows that come before a (key,id) position, and those at or before it. */
  position:(rows:Keyed[],mark:Keyed)=>{const at=sortable(mark,integer);let before=0,through=0;for(const row of rows){const c=compare(sortable(row,integer),at);if(c<0)before++;if(c<=0)through++}return {before,through}},
 }
}
