export function crmNetwork({customer,writeResult}){
 const notes=new Map(),tasks=new Map(),fieldWrites=[];let revision='2026-10-23T12:00:00Z',stage='customer',race=false;
 const hubContact={firstname:'Synthetic',lastname:'Customer',hubspot_owner_id:'801',lifecyclestage:stage,support_entitlement:stage,plan:'Synthetic plan',support_note:'No open escalations'},hubAccount={name:'Synthetic account',hubspot_owner_id:'802',support_entitlement:'priority',plan:'Company plan',support_note:'No open escalations'},sfContact={Id:customer,Name:'Synthetic customer',AccountId:'801',OwnerId:'802',Support_Entitlement__c:stage,Plan__c:'Synthetic plan',Support_Note__c:'No open escalations'},sfAccount={Id:'801',Name:'Synthetic account',OwnerId:'802',Support_Entitlement__c:'priority',Plan__c:'Company plan',Support_Note__c:'No open escalations'};
 const handle=(url,request,data)=>{
  const path=url.pathname,hub=url.hostname==='api.hubapi.com';
  const mutate=(record,properties)=>{if(race){race=false;return new Response('',{status:412})}Object.assign(record,properties);revision='2026-10-23T14:00:00Z';fieldWrites.push({hub,properties});return writeResult(hub?{id:record===hubContact?customer:'801',properties:record,updatedAt:revision}:{});};
  if(hub){
   if(path==='/account-info/v3/details')return {portalId:301};
   if(path===`/crm/v3/objects/contacts/${customer}`){if(request.method==='PATCH')return mutate(hubContact,data.properties);return {id:customer,updatedAt:revision,properties:hubContact};}
   if(path===`/crm/v4/objects/contacts/${customer}/associations/companies`)return {results:[{toObjectId:801,associationTypes:[{typeId:1,label:'Primary',category:'HUBSPOT_DEFINED'}]}]};
   if(path==='/crm/v3/objects/companies/801'){if(request.method==='PATCH')return mutate(hubAccount,data.properties);return {id:'801',updatedAt:revision,properties:hubAccount};}
   if(path.startsWith('/crm/v3/properties/'))return {name:path.split('/').pop(),type:'string',modificationMetadata:{readOnlyValue:false}};
   if(path==='/crm/v3/objects/notes'&&data){const r={id:'synthetic-happytohelp-note-'+notes.size,properties:data.properties,associations:{contacts:{results:[{id:data.associations[0].to.id}]}}};notes.set(r.id,r);return writeResult(r);}
   if(path.startsWith('/crm/v3/objects/notes/'))return notes.get(path.split('/').pop());
  }else{
   if(path==='/services/oauth2/userinfo')return {organization_id:'synthetic-happytohelp-501'};
   if(path==='/services/data/v66.0/query')return {done:true,records:[{AccountId:'801',IsDirect:true,Roles:'Decision Maker'}]};
   if(path==='/services/data/v66.0/sobjects/Contact/'+customer){if(request.method==='PATCH'){if(request.headers.get('if-unmodified-since')!==new Date(revision).toUTCString())return new Response('',{status:412});return mutate(sfContact,data);}return {...sfContact,LastModifiedDate:revision};}
   if(path==='/services/data/v66.0/sobjects/Account/801'){if(request.method==='PATCH'){if(request.headers.get('if-unmodified-since')!==new Date(revision).toUTCString())return new Response('',{status:412});return mutate(sfAccount,data);}return {...sfAccount,LastModifiedDate:revision};}
   if(path.endsWith('/describe'))return {updateable:true,fields:['Support_Note__c','Plan__c','Support_Entitlement__c'].map(name=>({name,type:'string',updateable:true,nillable:true,length:2000}))};
   if(path==='/services/data/v66.0/sobjects/Task'&&data){const r={Id:'synthetic-happytohelp-task-'+tasks.size,...data};tasks.set(r.Id,r);return writeResult({id:r.Id,success:true});}
   if(path.startsWith('/services/data/v66.0/sobjects/Task/'))return tasks.get(path.split('/').pop());
  }
  return new Response('Unavailable',{status:404});
 };
 return {handle,notes,tasks,fieldWrites,changeSource(){stage='subscriber';revision='2026-10-23T13:00:00Z';hubContact.support_entitlement=stage;hubContact.lifecyclestage=stage;sfContact.Support_Entitlement__c=stage},conflictAtPatch(){race=true}};
}
