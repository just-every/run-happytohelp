import assert from 'node:assert/strict';

export async function seedPortableBusiness(origin,projectId,contactId,token){
 const call=async(path,body,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,await response.clone().text());return response.json();
 };
 const native=`/api/management/projects/${projectId}`,knowledge=`/api/knowledge/${projectId}`;
 const field=(await call(native+'/company-fields',{name:'Support plan',type:'dropdown',options:['Enterprise','Standard']})).field;
 const company=(await call(native+'/companies',{name:'Northstar Bikes',domains:['northstar.example'],attributes:{[field.id]:'Enterprise'}})).company;
 await call(native+`/companies/${company.id}/members/${contactId}`,{},'PUT');
 const dataset=await call(knowledge+'/datasets',{name:'Portable support policy',refreshMode:'weekly'});
 const documents=revision=>[{url:'https://northstar.example/help/returns',title:'Returns',content:`Returns are accepted within ${revision===1?30:45} days. Retained version ${revision}.`}];
 for(const revision of [1,2]){
  await call(knowledge+`/datasets/${dataset.id}/refresh`,{documents:documents(revision),semantic:false});
  let ready=false;for(let i=0;i<240;i++){const state=await call(knowledge+`/datasets/${dataset.id}`);if(state.status==='ready'&&!state.claim_token){ready=true;break}assert.notEqual(state.status,'failed',state.error);await new Promise(resolve=>setTimeout(resolve,250))}assert.ok(ready,'native lexical ingestion completes');
 }
 const article=await call(knowledge+'/articles',{title:'Parcel returns',slug:'portable-parcel-returns',content:'Keep the parcel label.',status:'published'});
 const macro=(await call(native+'/macros',{title:'Parcel follow-up',content:'Hello {{requester.first_name | there}}, keep your parcel label.',actions:{reply_type:'note'},scope:{visibility:'shared',roles:[],groups:[],brands:[]}})).data;
 const updatedMacro=(await call(native+`/macros/${macro.id}`,{title:macro.title,content:'Hello {{requester.first_name | there}}, your parcel is ready.',actions:{reply_type:'note'},scope:macro.scope,expected_version:macro.version},'PUT')).data;
 return {projectId,companyId:company.id,fieldId:field.id,contactId,datasetId:dataset.id,articleId:article.id,macroId:updatedMacro.id};
}

export async function verifyPortableBusiness(origin,state,token){
 const get=async path=>{const response=await fetch(origin+path,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);return response.json()};
 const native=`/api/management/projects/${state.projectId}`,knowledge=`/api/knowledge/${state.projectId}`;
 const company=await get(native+'/companies/'+state.companyId);assert.equal(company.company.name,'Northstar Bikes');assert.equal(company.company.attributes[state.fieldId],'Enterprise');
 const dataset=await get(knowledge+'/datasets/'+state.datasetId);assert.equal(dataset.status,'ready');assert.equal(dataset.refresh_mode,'manual','a restored source never resumes its old refresh schedule');assert.equal(dataset.next_refresh_at,null);
 const found=await get(knowledge+'/search?q=Returns');assert.ok(found.citations.some(row=>row.content.includes('45 days')));
 const articles=await get(knowledge+'/articles');assert.equal(articles.find(row=>row.id===state.articleId)?.content,'Keep the parcel label.');
 const macro=await get(native+'/macros/'+state.macroId);assert.equal(macro.data.version,2);assert.ok(macro.data.content.includes('parcel is ready'));
 const versions=await get(native+'/macros/'+state.macroId+'/versions');assert.equal(versions.data.length,2);assert.ok(versions.data.some(row=>row.content.includes('keep your parcel label')));
}
