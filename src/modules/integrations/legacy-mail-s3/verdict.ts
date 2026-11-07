import {alignedDomain,type SenderVerdict} from '../inbound-sender'
import type {HeaderLine} from './envelope'

/** Who wrote a message, by the verdict Amazon SES put on top of it. SES writes `Authentication-Results:
 * amazonses.com; spf=pass (…) client-ip=…; envelope-from=…; helo=…; dkim=pass header.i=@…; dmarc=pass header.from=…;`
 * so `client-ip` is a property of the spf result and `envelope-from` and `helo` are separate segments that belong to
 * it. Only the first `Authentication-Results` counts, and only from the authserv-id `amazonses.com`: every header
 * below it was written by the sender or an earlier hop. */
const SES_AUTHSERV='amazonses.com'
const NEITHER:SenderVerdict={verified:false,failed:false}
const AMBIGUOUS:SenderVerdict={verified:false,failed:true}
// Where each segment may stand: spf, its envelope-from and helo, every dkim result, then dmarc.
const ORDER:Record<string,number>={spf:1,'envelope-from':2,helo:3,dkim:4,dmarc:5}
const ONCE=new Set(['spf','envelope-from','helo','dmarc'])
const METHODS=new Set(['spf','dkim','dmarc'])
const DOMAIN=/^(?=.{1,253}\.?$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*\.?$/i
const ADDRESS_LITERAL=/^\[(?:IPv6:)?[0-9a-f.:]+\]$/i
const IDENTITY=/^(?:[a-z0-9._%+-]+)?@[a-z0-9.-]+$/i
const domainOf=(value:string)=>value.slice(value.lastIndexOf('@')+1).toLowerCase().replace(/\.$/,'')

/** `;`-separated segments with comments read as whitespace, or null when a comment or quote is unbalanced, or holds a
 * separator, a quote or a quoted pair: text a sender could use to reshape the header is never read. */
function segments(value:string):string[]|null{
 const out:string[]=[];let current='',depth=0
 for(const char of value){
  if(depth>0){
   if(char==='\\'||char==='"'||char===';')return null
   if(char==='(')depth++
   else if(char===')'&&--depth===0)current+=' '
   continue
  }
  if(char==='(')depth=1
  else if(char===')'||char==='\\'||char==='"')return null
  else if(char===';'){out.push(current);current=''}
  else current+=char
 }
 if(depth>0)return null
 out.push(current)
 return out
}
interface Result {method:string;result:string;properties:Record<string,string>}
/** The results SES reported, with the spf identity folded in, or null when the header is ambiguous. */
function parse(value:string):{results:Result[]}|null{
 const parts=segments(value)
 if(!parts||!new RegExp(`^${SES_AUTHSERV.replace('.','\\.')}(?:\\s+\\d+)?$`,'i').test(parts[0].trim()))return null
 const rest=parts.slice(1)
 if(rest.length&&!rest[rest.length-1].trim())rest.pop()
 const results:Result[]=[];let rank=0
 const seen=new Set<string>()
 for(const part of rest){
  const words=part.trim().split(/\s+/),head=words.shift()?.match(/^([a-z0-9-]+)=([\x21-\x7e]+)$/i)
  if(!head)return null
  const name=head[1].toLowerCase(),order=ORDER[name]
  if(!order||order<rank||ONCE.has(name)&&seen.has(name))return null
  rank=order;seen.add(name)
  if(name==='envelope-from'||name==='helo'){
   // An identity of the spf result: one value, nothing after it, and spf must precede it.
   if(words.length||!seen.has('spf'))return null
   const value=head[2],spf=results.findLast(entry=>entry.method==='spf')
   if(!spf||name==='helo'&&!(DOMAIN.test(value)||ADDRESS_LITERAL.test(value))||name==='envelope-from'&&!/^[^\s@<>]+@[a-z0-9.-]+$/i.test(value)||name in spf.properties)return null
   spf.properties[name]=value
   continue
  }
  const properties:Record<string,string>={}
  for(const word of words){
   const match=word.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)?)=([\x21-\x7e]+)$/i),key=match?.[1].toLowerCase()
   if(!match||key! in properties)return null
   if((key==='header.d'||key==='header.from')&&!DOMAIN.test(match[2])||key==='header.i'&&!IDENTITY.test(match[2]))return null
   properties[key!]=match[2]
  }
  results.push({method:name,result:head[2].toLowerCase(),properties})
 }
 if(results.some(entry=>!METHODS.has(entry.method)))return null
 return {results}
}
export function sesVerdict(lines:readonly HeaderLine[],from:string|null):SenderVerdict{
 const top=lines.find(line=>line.key==='authentication-results')
 // A missing header, or a top header any other server wrote, says nothing either way.
 if(!top||top.value.split(/[\s;(]/,1)[0].toLowerCase()!==SES_AUTHSERV)return NEITHER
 const parsed=parse(top.value),fromDomain=from?domainOf(from):null
 // A dmarc result for any domain other than the From's means SES read a different From than we did.
 if(!parsed||parsed.results.some(entry=>entry.method==='dmarc'&&'header.from' in entry.properties&&!(fromDomain&&domainOf(entry.properties['header.from'])===fromDomain)))return AMBIGUOUS
 const verified=Boolean(fromDomain)&&parsed.results.some(({method,result,properties})=>result==='pass'&&(
  method==='dmarc'&&'header.from' in properties||
  method==='dkim'&&alignedDomain(properties['header.d']||(properties['header.i']?domainOf(properties['header.i']):''),fromDomain)||
  method==='spf'&&'envelope-from' in properties&&alignedDomain(domainOf(properties['envelope-from']),fromDomain)))
 return {verified,failed:!verified&&parsed.results.some(({result})=>result==='fail')}
}
