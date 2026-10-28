import {jsonPositions,type JsonPosition} from './json-index'
import {LIMITS} from '../types'
import {IndexLimitError} from './admission-error'
import {object} from './common'
/** Only packaging is ours: each leaf is an unmodified documented API response.
 * The strict scanner validates every field before JSON.parse can discard duplicates. */
export function helpScoutPositions(raw:string,maxRecords:number):JsonPosition[]{
 const offsets=new Map<string,JsonPosition>()
 const syntax=jsonPositions(raw,LIMITS.records,true,position=>{if(position.pointer.split('/').length<=7){if(offsets.size>=LIMITS.identityNodes)throw new Error('upload_identity_node_limit');offsets.set(position.pointer,position)}})
 if(syntax.some(position=>position.error))return syntax.filter(position=>position.error)
 const root=JSON.parse(raw),result:JsonPosition[]=[],esc=(s:string)=>s.replace(/~/g,'~0').replace(/\//g,'~1')
 const add=(pointer:string,sourceKind:string)=>{const position=offsets.get(pointer);if(!position)throw new Error('helpscout_document_depth_unsupported');if(result.length>=maxRecords)throw new IndexLimitError(position.row,pointer);result.push({...position,sourceKind})}
 const kinds:Record<string,string>={organizations:'organization',conversations:'conversation',customers:'contact',tags:'tag',collections:'collection',categories:'category',articles:'article-ref'}
 function record(value:any,pointer:string,hint?:string){
  if(!object(value))throw new Error('helpscout_record_must_be_object')
  if(hint){add(pointer,hint);return}
  if(object(value.article)){add(`${pointer}/article`,'article');for(const key of Object.keys(value))if(key!=='article')add(`${pointer}/${esc(key)}`,`metadata:${pointer}/${key}`);return}
  if(object(value.organization)){add(`${pointer}/organization`,'organization');for(const key of Object.keys(value))if(key!=='organization')add(`${pointer}/${esc(key)}`,`metadata:${pointer}/${key}`);return}
  if(object(value._embedded)&&Array.isArray(value._embedded.threads)&&value.page){add(pointer,'thread-page');return}
  if(value.id!==undefined){const kind=typeof value.threads==='number'&&value.primaryCustomer?'conversation':value.firstName!==undefined||value._embedded?.emails?'contact':value.siteId!==undefined?'collection':value.collectionId!==undefined&&value.defaultSort!==undefined?'category':typeof value.text==='string'&&value.collectionId!==undefined?'article':undefined;if(!kind)throw new Error('helpscout_detail_shape_unknown');add(pointer,kind);return}
  if(object(value._embedded)){
   const collections=Object.keys(value._embedded).filter(key=>kinds[key]&&Array.isArray(value._embedded[key]));if(collections.length===1)add(pointer,`inbox-list:${collections[0]}`)
   for(const [key,items] of Object.entries(value._embedded)){if(kinds[key]&&Array.isArray(items))items.forEach((item,i)=>record(item,`${pointer}/_embedded/${key}/${i}`,kinds[key]));else add(`${pointer}/_embedded/${esc(key)}`,`metadata:${pointer}/_embedded/${key}`)}
   for(const key of Object.keys(value))if(!['_embedded','page','_links'].includes(key))add(`${pointer}/${esc(key)}`,`metadata:${pointer}/${key}`)
   return
  }
  let recognised=false
  for(const [key,items] of Object.entries(value)){
   if(kinds[key]&&object(items)&&Array.isArray(items.items)){recognised=true;add(`${pointer}/${key}`,`docs-list:${key}`);items.items.forEach((item:any,i:number)=>record(item,`${pointer}/${key}/items/${i}`,kinds[key]))}
   else if(Array.isArray(items)&&(kinds[key]||['responses','threadPages','articleDetails','articleDrafts'].includes(key))){recognised=true;items.forEach((item,i)=>record(item,`${pointer}/${key}/${i}`,key==='articleDrafts'?'article-draft':['responses','threadPages','articleDetails'].includes(key)?undefined:kinds[key]))}
   else add(`${pointer}/${esc(key)}`,`metadata:${pointer}/${key}`)
  }
  if(!recognised&&Object.keys(value).length===0)throw new Error('helpscout_document_shape_required')
 }
 if(Array.isArray(root))root.forEach((value,i)=>record(value,`/${i}`));else record(root,'')
 return result
}
