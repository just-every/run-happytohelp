import type {SourceRecord} from '../../import-kit/src/types'
import {object,sourceId} from './common'
const singular:Record<string,string>={teams:'team',organizations:'organization',conversations:'conversation',customers:'contact',tags:'tag',collections:'collection',categories:'category',articles:'article-ref'}
/** Reconcile documented list receipts. A list cannot borrow a terminal receipt
 * from another mailbox/filter or claim completeness from an invented flag. */
export function helpScoutListIssues(records:SourceRecord[]){
 const groups=new Map<string,{record:SourceRecord;items:any[];page:any;url?:URL}[]>(),issues=new Map<string,string>()
 for(const record of records){const inbox=record.kind.startsWith('inbox-list:'),docs=record.kind.startsWith('docs-list:');if(!inbox&&!docs)continue
  const kind=record.kind.split(':')[1],p=record.payload as any,items=inbox?p._embedded?.[kind]:p.items;let url:URL|undefined,scope=kind
  if(inbox){try{url=new URL(p._links?.self?.href);const query=new URLSearchParams(url.search);query.delete('page');scope+=`${url.origin}${url.pathname}?${query.toString()}`}catch{}}
  else if(kind!=='collections')scope+=`:${[...new Set((items??[]).map((item:any)=>String(item.collectionId)))].sort().join(',')}`
  const group=groups.get(scope)??[];group.push({record,items,page:inbox?p.page:{number:p.page,totalPages:p.pages,totalElements:p.count},url});groups.set(scope,group)
 }
 for(const group of groups.values()){
  const kind=group[0].record.kind.split(':')[1],inbox=group[0].record.kind.startsWith('inbox-list:'),fail=(reason:string)=>{for(const entry of group){issues.set(`${entry.record.kind}/${entry.record.sourceId}`,reason);for(const item of entry.items??[]){try{issues.set(`${singular[kind]}/${sourceId(item.id,'helpscout')}`,reason);if(kind==='articles')issues.set(`article/${sourceId(item.id,'helpscout')}`,reason)}catch{}}}}
  try{
   group.sort((a,b)=>(a.page?.number??0)-(b.page?.number??0));const first=group[0].page
   if(!object(first)||![first.number,first.totalPages,first.totalElements].every(n=>Number.isSafeInteger(n)&&n>=0)||first.totalPages<1||group.length!==first.totalPages)throw new Error('source_list_pages_incomplete')
   const ids=new Set<string>();let total=0
   group.forEach((entry,index)=>{const p=entry.page,source=entry.record.payload as any
    if(!object(p)||p.number!==index+1||p.totalPages!==first.totalPages||p.totalElements!==first.totalElements||!Array.isArray(entry.items))throw new Error('source_list_pagination_invalid')
    if(inbox){const url=entry.url,next=source._links?.next;if(!url||url.origin!=='https://api.helpscout.net'||url.pathname!==`/v2/${kind}`||(url.searchParams.get('page')??'1')!==String(p.number)||!Number.isSafeInteger(p.size)||p.size<1||entry.items.length>p.size)throw new Error('source_list_scope_invalid');if(index===group.length-1){if(next!==undefined)throw new Error('source_list_terminal_missing')}else{const nextUrl=new URL(next?.href);if(nextUrl.origin!==url.origin||nextUrl.pathname!==url.pathname||nextUrl.searchParams.get('page')!==String(p.number+1)||[...nextUrl.searchParams].filter(([key])=>key!=='page').toString()!==[...url.searchParams].filter(([key])=>key!=='page').toString())throw new Error('source_list_next_invalid')}}
    for(const item of entry.items){const id=sourceId(item.id,'helpscout');if(ids.has(id))throw new Error('source_list_duplicate_id');ids.add(id);total++}
   });if(total!==first.totalElements)throw new Error('source_list_count_incomplete')
  }catch(error){fail(error instanceof Error?error.message:'source_list_invalid')}
 }
 return issues
}
