import {contactBands,type Bands} from './contact-bands'
const meta=(key:string)=>`json_extract(metadata_json,'$.${key}')`
export type Clause={sql:string;params:unknown[]}
export const clauses=(list:Clause[]):Clause=>({sql:list.map(clause=>clause.sql).join(' AND '),params:list.flatMap(clause=>clause.params)})
const sortName={last_seen_at:'last_seen',name:'name',email:'email',country:'country'} as const
/** The contacts list's sort keys, exactly as the list has always ordered them (then id ascending in either
 * direction), the index holding each order over every contact (contacts_name_order in migration 313, the others in
 * 318) and the one over the contacts a term can match (318). */
export type ContactSort={key:string;index:Record<string,string>;searchable:Record<string,string>;integer:boolean;column:string;bandColumn:string;bands:Bands}
export const contactSorts:Record<string,ContactSort>=Object.fromEntries(Object.entries({
 last_seen_at:`CAST(coalesce(${meta('last_seen_at')},0) AS INTEGER)`,
 name:`coalesce(nullif(${meta('provided_name')},''),name,'') COLLATE NOCASE`,
 email:`coalesce(nullif(${meta('provided_email')},''),email,'') COLLATE NOCASE`,
 country:`coalesce(nullif(${meta('country_name')},''),${meta('country_code')},'') COLLATE NOCASE`,
}).map(([sort,key])=>{const name=sortName[sort as keyof typeof sortName],integer=sort==='last_seen_at';return [sort,{key,integer,
 index:{asc:sort==='name'?'contacts_name_order':`contacts_${name}_asc`,desc:`contacts_${name}_desc`},
 searchable:{asc:`contacts_searchable_${name}_asc`,desc:`contacts_searchable_${name}_desc`},
 column:`${name}_key`,bandColumn:`${name}_band`,bands:contactBands(key,integer)}]}))
/** Exactly the list's count without a term (and contact_tallies' rule, migration 318). */
export const contactLive:Clause={sql:`coalesce(${meta('is_deleted')},0)!=1`,params:[]}
const fields=['name','email',meta('provided_name'),meta('provided_email')]
/** A contact a non-empty term can match: one of the four values is not empty. Written exactly as the searchable
 * indexes' predicate (migration 318), so a term's statement that adds it may use them; a match implies it. */
export const contactSearchable:Clause={sql:`(${fields.map(field=>`coalesce(${field},'')<>''`).join(' OR ')})`,params:[]}
/** A search matches a literal, ASCII case-insensitive substring of the name, email, provided name or provided
 * email. An empty term matches every contact. A term of three or more code points (no NUL) is also a phrase of
 * contact_search (migration 318: the same four values through SQLite's lower(), scoped to the workspace's live
 * contacts), which finds and counts its matches; `instr` over lower() decides each one exactly as LIKE did, with no
 * LIKE pattern length limit. Shorter terms keep the LIKE test the index cannot answer. */
export function contactTerm(search:string):(Clause&{needle?:string})|undefined{
 if(!search)return undefined
 const needle=search.replace(/[A-Z]/g,letter=>letter.toLowerCase())
 if(Array.from(needle).length>=3&&!needle.includes('\0'))return {sql:`(${fields.map(field=>`instr(lower(coalesce(${field},'')),?)>0`).join(' OR ')})`,params:fields.map(()=>needle),needle}
 const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`
 return {sql:`(${fields.map(field=>`coalesce(${field},'') LIKE ? ESCAPE '\\'`).join(' OR ')})`,params:fields.map(()=>term)}
}
/** The contact_search query for a term's matches in a workspace: its scope, and the term as a phrase of the identity
 * columns. Both are quoted, so neither can become FTS syntax. */
export const contactMatch=(projectId:string,needle:string)=>{const phrase=(text:string)=>'"'+text.replace(/"/g,'""')+'"';return `{scope} : ${phrase('\u0001'+projectId+'\u0001')} AND {name email provided_name provided_email} : ${phrase(needle)}`}
/** One contacts list request: a page by number, or the page after or before a boundary contact (its id). */
export type ContactQuery={db:D1Database;projectId:string;page:number;limit:number;counted:boolean;after:string;before:string;sort:string;direction:string;term:ReturnType<typeof contactTerm>}
/** A page's rows and the page number it shows; `more` when it is known without a total, `total` when counted. */
export type ContactPage={page:number;rows:Record<string,unknown>[];more?:boolean;total?:number}
