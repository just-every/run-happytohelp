import {compile} from 'html-to-text'
import {unicodeCaseFold} from './case-fold'

/** Offsets are UTF-16 string indices, including all units of each grapheme. */
export interface Word {word:string;start:number;end:number}
const graphemes=new Intl.Segmenter('und',{granularity:'grapheme'})
const blockTags=new Set('address article aside blockquote br caption center dd details dialog dir div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr legend li listing main menu nav ol p plaintext pre search section summary table tbody td tfoot th thead tr ul xmp'.split(' '))
// Use the already shipped HTML parser's complete entity table. Sentinels keep
// whitespace entities from disappearing when the text converter trims output.
const entityText=compile({wordwrap:false,preserveNewlines:true})
const entityCache=new Map<string,string>()
function decodeEntity(value:string){
 const cached=entityCache.get(value)
 if(cached!==undefined)return cached
 const decoded=entityText('x'+value+'x').slice(1,-1)
 if(entityCache.size>=2048)entityCache.clear()
 entityCache.set(value,decoded)
 return decoded
}
/** Pair destinations once; malformed nested links cannot cause rescanning. */
function linkEnds(input:string){
 const stack:number[]=[],ends=new Map<number,number>()
 for(let at=0;at<input.length;at++){
  if(input[at]==='\\'){at++;continue}
  if(input[at]==='(')stack.push(at)
  if(input[at]===')'&&stack.length)ends.set(stack.pop()!,at+1)
 }
 return ends
}
/** Strip presentation while keeping a source range for every visible UTF-16
 * unit. Inline markup disappears; HTML blocks contribute a word separator. */
function visibleText(input:string){
 const chars:string[]=[],starts:number[]=[],ends:number[]=[],destinations=linkEnds(input)
 const append=(text:string,start:number,end:number)=>{chars.push(text);for(let unit=0;unit<text.length;unit++){starts.push(start);ends.push(end)}}
 for(let at=0;at<input.length;){
  const start=at,point=String.fromCodePoint(input.codePointAt(at)!);at+=point.length
  if(point==='<'){
   const markup=/^(?:<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?>)/i.exec(input.slice(start))
   if(markup){at=start+markup[0].length;if(markup[1]&&blockTags.has(markup[1].toLowerCase()))append(' ',start,at);continue}
  }
  if(point===']'){
   const end=input[at]==='('?destinations.get(at):undefined
   if(end!==undefined){at=end;continue}
   const reference=/^\]\[[^\]\r\n]*\]/.exec(input.slice(start))
   if(reference){at=start+reference[0].length;continue}
  }
  if(/[*_~`\[\]\\]/.test(point)||point==='!'&&input[at]==='[')continue
  if(point==='&'){
   const entity=/^&(?:#[xX][0-9a-f]+;?|#\d+;?|[a-z][a-z\d]*;?)/i.exec(input.slice(start))
   if(entity){at=start+entity[0].length;append(decodeEntity(entity[0]),start,at);continue}
  }
  append(point,start,at)
 }
 return {text:chars.join(''),starts,ends}
}
export function knowledgeWords(input:string):Word[]{
 const visible=visibleText(input),chars:string[]=[],starts:number[]=[],ends:number[]=[]
 // Normalize whole graphemes after markup/entity decoding, so a combining mark
 // separated by inline markup still composes with its base character.
 for(const {segment,index} of graphemes.segment(visible.text)){
  const folded=unicodeCaseFold(segment.normalize('NFKC')).normalize('NFKC').replace(/\p{P}/gu,'')
  chars.push(folded)
  for(let unit=0;unit<folded.length;unit++){starts.push(visible.starts[index]);ends.push(visible.ends[index+segment.length-1])}
 }
 const normalized=chars.join(''),words:Word[]=[]
 for(const match of normalized.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)){
  const first=match.index!,last=first+match[0].length-1
  words.push({word:match[0],start:starts[first],end:ends[last]})
 }
 return words
}
export function shingleHash(value:string){let a=2166136261,b=5381;for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')}
export function wordShingles(words:Word[]){const rows:{hash:string;words:string;start:number;end:number}[]=[];for(let index=0;index+12<=words.length;index++){const key=words.slice(index,index+12).map(word=>word.word).join(' ');rows.push({hash:shingleHash(key),words:key,start:words[index].start,end:words[index+11].end})}return rows}
