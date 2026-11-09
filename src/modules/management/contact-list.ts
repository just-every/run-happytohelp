import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {resourcePage} from './resource-list'
import {contactLive,contactSorts,contactTerm,type ContactPage,type ContactQuery} from './contact-order'
import {contactsById,keyedMatches,matchedPage} from './contact-matches'
import {seekMatches} from './contact-seek'
import {walkedPage} from './contact-walk'
import type {Keyed} from './contact-key-order'

// A term of three or more characters reads its matches with their keys from contact_search, one row each. With a
// total it reads them all: the total is their number, within 5,000 + 1.5 x the total. Without one, a page seeks its
// rows past its boundary (contact-seek.ts) within SEEK_BUDGET rows; where that is not enough, a term with as many
// matches as the rest of PAGE_TARGET leaves reads them whole, and a broader one seeks on without a budget.
const SEEK_BUDGET=2000,PAGE_TARGET=4900

/** A page without a total sought past its boundary contact (the first page from the start), or the rows its seeks
 * read when they ran out of `budget`. Undefined for a page by number past the first, which steps over the earlier
 * rows as before. */
async function soughtPage(q:ContactQuery,budget?:number):Promise<ContactPage|{over:number}|undefined>{
 const {db,projectId,page,limit,after,before,term}=q,{key}=contactSorts[q.sort],id=after||before
 if(page>1&&!id)return undefined
 const mark=id&&page>1?await db.prepare(`SELECT id,typeof(k) type,CAST(k AS TEXT) key,listed FROM (SELECT id,${key} k,(${contactLive.sql} AND ${term!.sql}) listed FROM contacts WHERE id=? AND project_id=?)`).bind(...term!.params,id,projectId).first<Keyed&{listed:number}>():null
 let spent=0
 const shown=async(from:Keyed|null,forward:boolean,need:number):Promise<Keyed[]|{over:number}|undefined>=>{
  const sought=await seekMatches(q,from,forward,need,budget===undefined?undefined:budget-spent)
  if(!sought)return undefined
  if('over' in sought)return {over:spent+sought.over}
  spent+=sought.spent;return sought.found
 }
 // A boundary that is gone answers the first page; so does a page before the first.
 const first=async()=>{const found=await shown(null,true,limit+1);return Array.isArray(found)?{page:1,rows:await contactsById(q,found.map(row=>row.id))}:found}
 if(!mark)return first()
 if(after){const found=await shown(mark,true,limit+1);return Array.isArray(found)?{page,rows:await contactsById(q,found.map(row=>row.id))}:found}
 const earlier=await shown(mark,false,limit)
 if(!Array.isArray(earlier))return earlier
 if(earlier.length<limit)return first()
 const listed=earlier.reverse()
 // The page before the boundary has more when the boundary is still listed, or anything else follows its last row.
 let more=Boolean(mark.listed)
 if(!more){const following=await shown(listed[listed.length-1],true,1);if(!Array.isArray(following))return following;more=following.length>0}
 return {page,rows:await contactsById(q,listed.map(row=>row.id)),more}
}

async function contactPage(q:ContactQuery):Promise<ContactPage>{
 if(q.term?.needle===undefined)return walkedPage(q)
 if(q.counted){const found=await keyedMatches(q);return await matchedPage(q,found,found.length)??walkedPage(q,found.length)}
 const sought=await soughtPage(q,SEEK_BUDGET)
 if(!sought||!('over' in sought))return sought??walkedPage(q)
 // The page's own rows and its boundary come on top of the matches read.
 const most=Math.max(0,PAGE_TARGET-sought.over-q.limit-2),found=await keyedMatches(q,{most})
 if(found.length<=most)return await matchedPage(q,found)??walkedPage(q)
 const unbounded=await soughtPage(q)
 return unbounded&&!('over' in unbounded)?unbounded:walkedPage(q)
}

/** The contacts list (`GET …/contacts`, both doors): a page by number, or the page after (`after`) or before
 * (`before`) a boundary contact, the last or first one shown, with `page` the number it shows. A term's few matches
 * are read once and ordered; otherwise the page walks its order's index (src/modules/management/README.md, "Contacts"). */
export async function listContacts(c:Context<AppEnv>,projectId:string){
 const {page,limit}=resourcePage(c),search=c.req.query('search')||''
 if(search.length>500)throw new HTTPException(400,{message:'Search is too long'})
 const sort=c.req.query('sort')||'last_seen_at',direction=c.req.query('direction')||(sort==='last_seen_at'?'desc':'asc')
 if(!Object.hasOwn(contactSorts,sort)||!['asc','desc'].includes(direction))throw new HTTPException(400,{message:'Invalid sort order'})
 const after=c.req.query('after')||'',before=c.req.query('before')||''
 if(after&&before)throw new HTTPException(400,{message:'Invalid page boundary'})
 const q:ContactQuery={db:c.env.DB,projectId,page,limit,counted:c.req.query('total')!=='none',after,before,sort,direction,term:contactTerm(search)}
 const answer=await contactPage(q)
 if(!q.counted)return {data:answer.rows.slice(0,limit),pagination:{page:answer.page,limit,hasMore:answer.more??answer.rows.length>limit},sort,direction}
 const total=answer.total??0
 return {data:answer.rows,pagination:{page:answer.page,limit,total,hasMore:answer.page*limit<total},sort,direction}
}
