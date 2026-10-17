import {HTTPException} from 'hono/http-exception'
export interface PlaceholderResult {text:string;unresolved:string[]}
const tokenPattern=/{{\s*([^{}]+?)\s*}}/g
/** Explicit fallbacks use {{requester.first_name | there}}. Missing values stay
 * visible so editing or accidentally dropping client metadata cannot send them. */
export function renderPlaceholders(template:string,context:Record<string,unknown>):PlaceholderResult{
 const unresolved=new Set<string>()
 const text=template.replace(tokenPattern,(literal,expression:string)=>{
  const separator=expression.indexOf('|'),key=(separator<0?expression:expression.slice(0,separator)).trim()
  const fallback=separator<0?undefined:expression.slice(separator+1).trim()
  const value=Object.hasOwn(context,key)?context[key]:key.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'&&Object.hasOwn(v,k)?(v as any)[k]:undefined,context)
  if(Array.isArray(value)&&value.length&&value.every(v=>v!==null&&['string','number','boolean'].includes(typeof v)))return value.join(', ')
  if(value!==null&&value!==undefined&&value!==''&&['string','number','boolean'].includes(typeof value))return String(value)
  if(fallback!==undefined&&fallback.length)return fallback
  unresolved.add(key);return literal
 })
 return {text,unresolved:[...unresolved]}
}
export function unresolvedPlaceholders(content:string){return [...new Set([...content.matchAll(tokenPattern)].map(m=>m[1].split('|')[0].trim()))]}
export function assertPublicReplyPlaceholders(content:string){
 const unresolved=unresolvedPlaceholders(content)
 if(unresolved.length)throw new HTTPException(422,{res:new Response(JSON.stringify({error:'Resolve the highlighted placeholders before sending.',code:'unresolved_placeholders',unresolved}),{status:422,headers:{'Content-Type':'application/json'}})})
}
