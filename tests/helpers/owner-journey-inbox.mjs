import assert from 'node:assert/strict';
import {startApp} from '../journeys/kit/app.mjs';

export async function writtenContactsJourney(){
 const app=await startApp(),w=await app.seedWorkspace('written-contacts'),other=await app.seedWorkspace('other-written-contacts');
 const base=`/api/management/projects/${w.projectId}`,owner={token:w.tokens.owner};
 try{
  const create=async body=>(await app.ok(base+'/contacts',{...owner,body})).data;
  const email=await create({email:'synthetic-written@example.test'}),named=await create({name:'Page visitor'}),writer=await create({name:'Chat writer'});
  await app.ok('/api/conversations',{...owner,body:{projectId:w.projectId,contactId:writer.id}});
  const list=query=>app.ok(base+'/contacts?'+new URLSearchParams({sort:'name',direction:'asc',...query}),owner);
  const hidden=await list({visitors:'hide'});
  assert.deepEqual(new Set(hidden.data.map(row=>row.id)),new Set([email.id,writer.id]));
  assert.equal(hidden.pagination.total,2,'hidden visitors are absent from the count as well as the page');
  assert.ok((await list({visitors:'show'})).data.some(row=>row.id===named.id),'the owner can still inspect page visitors');
  for(const search of ['Page','Pa','synthetic','Chat']){
   const result=await list({visitors:'hide',search});
   assert.ok(!result.data.some(row=>row.id===named.id),'both indexed and short searches respect the filter');
   assert.equal(result.pagination.total,result.data.length);
  }
  const first=await list({visitors:'hide',limit:'1'}),next=await list({visitors:'hide',limit:'1',page:'2',after:first.data[0].id});
  assert.equal(first.pagination.total,2);assert.equal(next.pagination.total,2);assert.notEqual(next.data[0].id,first.data[0].id);
  const previous=await list({visitors:'hide',limit:'1',page:'1',before:next.data[0].id});assert.equal(previous.data[0].id,first.data[0].id);
  assert.equal((await app.call(base+'/contacts?visitors=hide',{token:other.tokens.owner})).status,403);
  assert.equal((await list({visitors:'hide',total:'none',search:'Page'})).data.length,0);
 }finally{await app.close();}
}

export async function profileWorkspaceJourney(){
 const {strangerFixture}=await import('./stranger11-browser.mjs');
 const f=await strangerFixture();let success=false;
 try{
  const {page,request,origin}=f;
  const second=await request('/api/management/projects',{name:'Synthetic second workspace',allowed_origin:origin});
  await page.goto(`${origin}/projects/${second.id}/conversations`);
  await page.getByRole('button',{name:`Switch workspace: ${second.name}`,exact:true}).waitFor();
  await page.goto(origin+'/users/profile');
  await page.getByRole('button',{name:`Switch workspace: ${second.name}`,exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Contacts',exact:true}).getAttribute('href'),`/projects/${second.id}/contacts`);
  await page.getByRole('link',{name:'Contacts',exact:true}).click();
  await page.waitForURL(`**/projects/${second.id}/contacts`);
  success=true;
 }finally{await f.close(success);}
}
