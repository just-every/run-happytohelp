import {contactMatch,contactSorts,type ContactPage,type ContactQuery} from './contact-order'
import {keyOrder,orderable,type Keyed} from './contact-key-order'

/** The contact_search query for a term's matches in the workspace, within a band of the page's sort if given
 * (contact-bands.ts). */
export function matchQuery(q:ContactQuery,band?:{value:string;level:number}){
 const match=contactMatch(q.projectId,q.term!.needle!),sort=contactSorts[q.sort]
 return band?`${match} AND {${sort.bandColumn}} : ${sort.bands.phrase(band.value,band.level)}`:match
}

/** A term's matches with their sort key (migration 318 carries each contact's id and keys with its contact_search
 * entry), one row each: every match, at most `most + 1` of them, or those within a band of the page's sort. */
export async function keyedMatches(q:ContactQuery,{most,band}:{most?:number;band?:{value:string;level:number}}={}){
 const column=contactSorts[q.sort].column
 const sql=`SELECT contact_id id,typeof(${column}) type,CAST(${column} AS TEXT) key FROM contact_search WHERE contact_search MATCH ?${most===undefined?'':' LIMIT ?'}`
 const params:unknown[]=[matchQuery(q,band),...(most===undefined?[]:[most+1])]
 return (await q.db.prepare(sql).bind(...params).all<Keyed>()).results
}

/** The listed contacts with these ids, in this order. */
export async function contactsById(q:ContactQuery,ids:string[]){
 const rows=ids.length?(await q.db.prepare('SELECT *,NULL created_by_name FROM contacts WHERE id IN (SELECT value FROM json_each(?)) AND +project_id=?').bind(JSON.stringify(ids),q.projectId).all<Record<string,unknown>>()).results:[]
 const byId=new Map(rows.map(row=>[String(row.id),row]))
 return ids.map(id=>byId.get(id)).filter(row=>row!==undefined)
}

/** A page, by number or from a boundary contact, from all of a term's matches with their keys, ordered exactly as
 * the list orders them. Undefined when a key is of another type than its sort's (SQLite's own order then sorts
 * them); the page then walks its order. A boundary that is gone, or a page before the first, answers the first page. */
export async function matchedPage(q:ContactQuery,found:Keyed[],total?:number):Promise<ContactPage|undefined>{
 const {db,projectId,page,limit,counted,after,before,direction}=q,{key,integer}=contactSorts[q.sort],id=after||before
 const mark=id&&page>1?await db.prepare(`SELECT id,typeof(k) type,CAST(k AS TEXT) key FROM (SELECT id,${key} k FROM contacts WHERE id=? AND project_id=?)`).bind(id,projectId).first<Keyed>():null
 if(!orderable(mark?[...found,mark]:found,integer))return undefined
 const order=keyOrder(integer,direction),listed=order.sort(found),position=mark?order.position(listed,mark):undefined
 let shown=page,start=(page-1)*limit
 if(id&&page>1){
  if(!position)shown=1,start=0
  else if(after)start=position.through
  else if(position.before<limit)shown=1,start=0
  else start=position.before-limit
 }
 return {page:shown,rows:await contactsById(q,listed.slice(start,start+limit).map(row=>row.id)),more:counted?undefined:start+limit<listed.length,total:counted?total??listed.length:undefined}
}
