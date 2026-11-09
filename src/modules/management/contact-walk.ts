import {clauses,contactLive,contactSearchable,contactSorts,type Clause,type ContactPage,type ContactQuery} from './contact-order'

/** A page that walks its order's index (migrations 313, 317) and stops after its rows: by number with OFFSET, or
 * from a boundary contact. With a term it walks the index of the contacts a term can match, so hidden drafts are
 * never read. Its total is the workspace's tally without a term, the given count of a term's matches, or (a term of
 * one or two characters) the matching contacts counted over that index. */
export async function walkedPage(q:ContactQuery,known?:number):Promise<ContactPage>{
 const {db,projectId,page,limit,counted,after,before,direction,term}=q,sort=contactSorts[q.sort],key=sort.key,index=(term?sort.searchable:sort.index)[direction]
 const where=clauses([{sql:'project_id=?',params:[projectId]},contactLive,...(term?[contactSearchable,term]:[])])
 const count=async()=>{
  if(known!==undefined)return known
  if(!term)return Number((await db.prepare('SELECT coalesce((SELECT total FROM contact_tallies WHERE project_id=?),0) total').bind(projectId).first<{total:number}>())?.total)||0
  return Number((await db.prepare(`SELECT count(*) total FROM contacts INDEXED BY ${index} WHERE ${where.sql}`).bind(...where.params).first<{total:number}>())?.total)||0
 }
 // Rows tied on the key are ordered by id alone, so their index range is read in order without a sort.
 const read=async(extra:Clause[],forward:boolean,size:number,offset=0,tied=false)=>{
  const list=clauses([where,...extra]),order=tied?`id ${forward?'ASC':'DESC'}`:forward?`${key} ${direction},id ASC`:`${key} ${direction==='asc'?'desc':'asc'},id DESC`
  return (await db.prepare(`SELECT *,NULL created_by_name FROM contacts INDEXED BY ${index} WHERE ${list.sql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...list.params,size,offset).all<Record<string,unknown>>()).results
 }
 // The rows past a boundary contact in the page's order (forward) or against it: those tied with it on the sort key
 // past its id, then those past its key, each part walking the index from its own start, so neither steps over the
 // rows tied with the boundary on its other side. Its key is read in the statement, in the key's own collation.
 const past=async(id:string,forward:boolean,size:number)=>{
  const bound=`(SELECT ${key} FROM contacts WHERE id=? AND project_id=?)`,up=(direction==='asc')===forward
  const [tied,rest]=await Promise.all([read([{sql:`${key}=${bound} AND id${forward?'>':'<'}?`,params:[id,projectId,id]}],forward,size,0,true),read([{sql:`${key}${up?'>':'<'}${bound}`,params:[id,projectId]}],forward,size)])
  return [...tied,...rest].slice(0,size)
 }
 const boundary=(id:string)=>db.prepare(`SELECT ${where.sql} listed FROM contacts WHERE id=? AND project_id=?`).bind(...where.params,id,projectId).first<{listed:number}>()
 const size=counted?limit:limit+1
 const byNumber=async(number:number):Promise<ContactPage>=>({page:number,rows:await read([],true,size,(number-1)*limit)})
 // A boundary that is gone (removed from the workspace) answers the first page; so does a page before the first.
 const rows=async():Promise<ContactPage>=>{
  if(!(after||before)||page===1)return byNumber(page)
  if(after){const [mark,found]=await Promise.all([boundary(after),past(after,true,size)]);return mark?{page,rows:found}:byNumber(1)}
  const [mark,earlier]=await Promise.all([boundary(before),past(before,false,limit)])
  if(!mark||earlier.length<limit)return byNumber(1)
  const found=earlier.reverse()
  // Without a total, a page before the boundary has more when the boundary is still listed, or anything else follows it.
  return {page,rows:found,more:counted?undefined:Boolean(mark.listed)||(await past(String(found[found.length-1].id),true,1)).length>0}
 }
 if(!counted)return rows()
 const [total,answer]=await Promise.all([count(),rows()])
 return {...answer,total}
}
