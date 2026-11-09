/** Bands of the contacts list's orders, for seeking a term's matches (contact-seek.ts). contact_search (migration 317)
 * holds each searchable contact's order text in its sort's band column, between two U+0002 and a U+0003: a text key
 * through lower() (NOCASE folds the same ASCII letters; substr stops at a NUL, where NOCASE stops comparing), or a
 * last seen as the first ten hex digits of its value with the sign bit flipped (2^24 ms, about 4.6 hours). A band
 * at a level is the keys whose order text starts with the same `level` characters, one stretch of the order; a
 * phrase of those characters asks contact_search for it, and a band can be split into the finer bands of a deeper
 * level. A text key shorter than the level is its own band, asked with the closing U+0003. */
export type Bands={levels:number[];at:(key:string,level:number)=>string;phrase:(band:string,level:number)=>string;
 /** The keys within the band holding key `k` (band `b`), or past it, in the walking direction. */
 within:(k:string,b:string,level:number,up:boolean)=>string;past:(k:string,b:string,level:number,up:boolean)=>string}

const quoted=(text:string)=>'"'+text.replace(/"/g,'""')+'"'
const hex=(k:string)=>`printf('%016x',${k})`
// Two's complement hex with its sign bit flipped orders as the integer does.
const flipped=(k:string)=>`substr('89abcdef01234567',instr('0123456789abcdef',substr(${hex(k)},1,1)),1)||substr(${hex(k)},2)`

export function contactBands(key:string,integer:boolean):Bands{
 if(integer){
  // A band of `level` hex digits holds the keys sharing their value shifted right by the other digits' bits.
  const shift=(level:number)=>4*(16-level),low=(k:string,level:number)=>`((${k})>>${shift(level)})<<${shift(level)}`
  const high=(k:string,level:number)=>`(${low(k,level)}|((1<<${shift(level)})-1))`
  return {levels:[8,10],at:(k,level)=>`substr(${flipped(k)},1,${level})`,phrase:band=>quoted('\u0002\u0002'+band),
   within:(k,_b,level,up)=>up?`${key}<=${high(k,level)}`:`${key}>=${low(k,level)}`,
   past:(k,_b,level,up)=>up?`${key}>${high(k,level)}`:`${key}<${low(k,level)}`}
 }
 // Going up a text band ends below every key past those starting with its characters (its own key when it is
 // shorter than the level); going down it starts at the band itself.
 const end=(k:string,b:string,level:number)=>`CASE WHEN length(${b})<${level} OR (${b}||char(1114111))<${k} COLLATE NOCASE THEN ${k} ELSE ${b}||char(1114111) END`
 const start=(k:string,b:string)=>`CASE WHEN ${k}<${b} COLLATE NOCASE THEN ${k} ELSE ${b} END`
 return {levels:[3,6,9,12,15,18,21,24],at:(k,level)=>`CASE WHEN typeof(${k})='text' THEN substr(lower(${k}),1,${level}) ELSE '' END`,
  phrase:(band,level)=>quoted('\u0002\u0002'+band+(Array.from(band).length<level?'\u0003':'')),
  within:(k,b,level,up)=>up?`${key}<=${end(k,b,level)}`:`${key}>=${start(k,b)}`,
  past:(k,b,level,up)=>up?`${key}>${end(k,b,level)}`:`${key}<${start(k,b)}`}
}
