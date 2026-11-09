import assert from 'node:assert/strict'

const live="coalesce(json_extract(metadata_json,'$.is_deleted'),0)!=1"
/** The contacts' live tally (migration 317) equals a fresh count of every workspace's live contacts. */
export async function assertContactTally(all,label){
 assert.deepEqual(await all('SELECT project_id,total FROM contact_tallies WHERE total<>0 ORDER BY project_id'),await all(`SELECT project_id,count(*) total FROM contacts WHERE ${live} GROUP BY project_id ORDER BY project_id`),label+': the contacts tally counts each workspace\'s live contacts')
}

const fields=['name','email',"json_extract(metadata_json,'$.provided_name')","json_extract(metadata_json,'$.provided_email')"]
/** contact_search (migration 317) agrees with contacts (integrity-check with rank=1 compares it with its content), and
 * a term's matches in each workspace are exactly its live contacts holding the term in one of the four values. */
export async function assertContactSearch(all,label,terms){
 await all("INSERT INTO contact_search(contact_search,rank) VALUES('integrity-check',1)")
 for(const {project_id:project} of await all('SELECT DISTINCT project_id FROM contacts ORDER BY project_id'))for(const term of terms){
  const needle=term.replace(/[A-Z]/g,letter=>letter.toLowerCase()),phrase=text=>'"'+text.replace(/"/g,'""')+'"'
  assert.deepEqual(await all('SELECT rowid FROM contact_search WHERE contact_search MATCH ? ORDER BY rowid',`{scope} : ${phrase('\u0001'+project+'\u0001')} AND {name email provided_name provided_email} : ${phrase(needle)}`),
   await all(`SELECT rowid FROM contacts WHERE project_id=? AND ${live} AND (${fields.map(field=>`instr(lower(coalesce(${field},'')),?)>0`).join(' OR ')}) ORDER BY rowid`,project,...fields.map(()=>needle)),`${label}: contact_search finds ${term} in ${project} exactly`)
 }
}

/** The contacts list's pages after or before a boundary contact (the last or first one shown) are the pages by
 * number, for every sort and direction, with and without a total and with a search, as contacts are added, renamed,
 * deleted and erased; the total without a term is the live count; an overloaded D1 is retried or answers 503. */
export async function contactPagesProof(app){
 const w=await app.seedWorkspace('contact-pages'),owner={token:w.tokens.owner},B=`/api/management/projects/${w.projectId}/contacts`
 const all=async(sql,...args)=>(await app.db.prepare(sql).bind(...args).all()).results
 const create=async(name,email)=>(await app.ok(B,{...owner,body:{name,email}})).data
 // Names tie under NOCASE, most contacts tie on last seen 0, and widget visitors bring a last seen and a country.
 const people=[]
 for(const [name,email] of [['Ada','ada@pages.example'],['ada','ada.two@pages.example'],['Bea','bea@pages.example'],['Cy',null],[null,'zed@pages.example'],['Dee','DEE@pages.example'],['Eve','eve@other.example']])people.push(await create(name,email))
 for(const country of ['FR','DE','FR'])await app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin,'CF-IPCountry':country},body:{widgetKey:w.widgetKey}})
 const list=async query=>{const answer=await app.call(B+'?'+new URLSearchParams(query),{...owner,status:200});return answer.data}
 const same=async label=>{
  const count=(await all(`SELECT count(*) n FROM contacts WHERE project_id=? AND ${live}`,w.projectId))[0].n
  assert.equal((await list({})).pagination.total,count,label+': the total without a term is the live count')
  await assertContactTally(all,label)
  await assertContactSearch(all,label,['pages.example','ada','zoe','dee','ann'])
  const orders=[]
  for(const sort of ['last_seen_at','name','email','country'])for(const direction of ['asc','desc'])orders.push({sort,direction,search:''})
  orders.push({sort:'name',direction:'asc',search:'pages.example'},{sort:'name',direction:'desc',search:'pages.example'},{sort:'email',direction:'asc',search:'pages.example'},{sort:'email',direction:'desc',search:'other.example'},{sort:'last_seen_at',direction:'desc',search:'ADA'},{sort:'email',direction:'desc',search:'a'})
  for(const search of ['pages.example','ADA','a','zz-none'])assert.equal((await list({search})).pagination.total,(await all(`SELECT count(*) n FROM contacts WHERE project_id=? AND ${live} AND (${fields.map(field=>`coalesce(${field},'') LIKE ? ESCAPE '\\'`).join(' OR ')})`,w.projectId,...fields.map(()=>`%${search}%`)))[0].n,`${label}: the total of ${search} is its matches counted`)
  for(const order of orders)for(const counted of [true,false]){
   const query=page=>({search:order.search,page:String(page),limit:'2',sort:order.sort,direction:order.direction,...(counted?{}:{total:'none'})})
   const pages=[await list(query(1))]
   while(pages.at(-1).pagination.hasMore)pages.push(await list(query(pages.length+1)))
   const name=`${label} ${JSON.stringify(order)} ${counted?'total':'none'}`
   assert.ok(pages.length>1||order.search,name+' spans pages')
   for(let page=2;page<=pages.length;page++)assert.deepEqual(await list({...query(page),after:pages[page-2].data.at(-1).id}),pages[page-1],name+` page ${page} after its boundary`)
   for(let page=1;page<pages.length;page++)assert.deepEqual(await list({...query(page),before:pages[page].data[0].id}),pages[page-1],name+` page ${page} before its boundary`)
  }
 }
 await same('first contacts')
 await create('Ann','ann@pages.example');await same('a contact added')
 await app.ok(`${B}/${people[2].id}`,{...owner,method:'PUT',body:{name:'Zoe'}});await same('a contact renamed')
 await app.ok(`${B}/${people[0].id}`,{...owner,method:'DELETE'});await same('a contact deleted')
 await app.ok(`${B}/${people[5].id}/erase`,{...owner,body:{}});await same('a contact erased')
 // A term whose few matches sit at both ends of a long order: a page without a total seeks past the stretch without
 // matches band by band, and every page after or before its boundary is still the page by number.
 await all(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<900) INSERT INTO contacts(id,project_id,name,email,created_at) SELECT printf('pages-bulk-%04d',i),?,char(97+i*676/901/26)||char(97+i*676/901%26)||printf(' Bulk %04d',i),printf('%s%d@%s.example',char(97+i*676/901/26),i,CASE WHEN i<=13 OR i>888 THEN 'farend' ELSE 'nearby' END),? FROM n`,w.projectId,Date.now())
 await assertContactSearch(all,'a long order added',['farend','bulk 0'])
 for(const order of [{sort:'name',direction:'asc'},{sort:'name',direction:'desc'},{sort:'email',direction:'asc'},{sort:'last_seen_at',direction:'desc'}])for(const counted of [true,false]){
  const query=page=>({search:'farend',page:String(page),limit:'5',...order,...(counted?{}:{total:'none'})})
  const pages=[await list(query(1))]
  while(pages.at(-1).pagination.hasMore)pages.push(await list(query(pages.length+1)))
  const name=`a long order ${JSON.stringify(order)} ${counted?'total':'none'}`
  assert.equal(pages.flatMap(page=>page.data).length,25,name+' lists every match')
  for(let page=2;page<=pages.length;page++)assert.deepEqual(await list({...query(page),after:pages[page-2].data.at(-1).id}),pages[page-1],name+` page ${page} after its boundary`)
  for(let page=1;page<pages.length;page++)assert.deepEqual(await list({...query(page),before:pages[page].data[0].id}),pages[page-1],name+` page ${page} before its boundary`)
 }
 // A boundary that is gone answers the first page.
 assert.deepEqual(await list({search:'',page:'3',limit:'2',sort:'name',direction:'asc',after:'missing-contact'}),await list({search:'',page:'1',limit:'2',sort:'name',direction:'asc'}))
 assert.equal((await app.call(B+'?after=a&before=b',owner)).status,400)
 // D1's overload at every call a contacts page and a page after its boundary make: retried to the same answer, or 503.
 const first=await list({search:'',page:'1',limit:'2',sort:'last_seen_at',direction:'desc'})
 const sparse=await list({search:'farend',page:'1',limit:'5',sort:'name',direction:'asc',total:'none'})
 for(const query of [{search:'',page:'1',limit:'2',sort:'last_seen_at',direction:'desc'},{search:'',page:'2',limit:'2',sort:'last_seen_at',direction:'desc',after:first.data.at(-1).id},{search:'pages.example',page:'2',limit:'2',sort:'name',direction:'asc',after:people[1].id},{search:'farend',page:'2',limit:'5',sort:'name',direction:'asc',total:'none',after:sparse.data.at(-1).id}]){
  const path=B+'?'+new URLSearchParams(query),calm=await app.call(path,{...owner,headers:{'x-test-meter-d1':'1'}}),calls=Number(calm.headers.get('x-test-d1-statements'))
  assert.equal(calm.status,200);assert.ok(calls>0)
  for(let at=1;at<=calls;at++){
   const fault={'x-test-fault':'d1-overloaded','x-test-statement-at':String(at)}
   const passing=await app.call(path,{...owner,headers:{...fault,'x-test-overloads':'2'}})
   assert.equal(passing.status,200,`${path} at ${at}`);assert.deepEqual(passing.data,calm.data,`${path} answers the same after a passing overload at ${at}`)
   const busy=await app.call(path,{...owner,headers:fault})
   assert.equal(busy.status,503,`${path} at ${at}`);assert.equal(typeof busy.data.error,'string')
   const wait=Number(busy.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,'Retry-After is whole seconds within D1\'s window')
  }
 }
}
