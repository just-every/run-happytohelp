import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';

export async function seedPortableCampaign(origin,projectId,token,widget){
 const call=async(path,body,method=body===undefined?'GET':'POST',as=token)=>{
  const response=await fetch(origin+path,{method,headers:{Origin:origin,Authorization:'Bearer '+as,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.ok(response.ok,await response.clone().text());return response.json();
 };
 const native=`/api/management/projects/${projectId}`,id='synthetic-happytohelp-83',identifier='synthetic-happytohelp-84';
 const config={name:'Portable parcel help',enabled:true,sender:'Alex · Support',brand:'Northstar Bikes',message:'Need help returning a parcel?',pathPrefix:'/returns',trigger:{type:'time',seconds:20},audience:'all',delaySeconds:20,dailyCap:1,timezone:'America/New_York',quietHours:{enabled:false,start:20,end:8}};
 const campaign=await call(native+'/widget-campaigns/'+id,{revision:0,...config},'PUT');
 await call(native+'/settings',{is_contact_tracking_enabled:true,proactive_help_enabled:true},'PUT');
 const visitor=await call('/api/identity/widget/session',{widgetKey:widget.widgetKey,identifier,contact_hash:createHmac('sha256',widget.verificationSecret).update(identifier).digest('hex'),name:'Northstar parcel visitor'});
 const conversation=await call('/api/conversations',{projectId},'POST',visitor.token);
 const command=(action,data)=>call(`/api/conversations/${conversation.id}/widget-events`,{action,data},'POST',visitor.token);
 await command('contextConsent',{consent:true});
 const offer=(await command('campaignEvaluate',{path:'/returns',elapsedSeconds:20,scrollPercent:50,exitIntent:false,visitId:randomUUID(),cartValue:0})).offer;
 assert.equal(offer?.campaignId,campaign.id);
 for(const event of ['show','open','dismiss'])assert.equal((await command('campaignEvent',{id:offer.id,event})).accepted,true);
 const report=(await call(`/api/dashboard/projects/${projectId}/reports?period=30`)).campaigns.find(row=>row.id===id);
 assert.deepEqual(report,{id,name:config.name,impressions:1,opens:1,dismissals:1,conversations:0,resolutions:0});
 return {campaign,report};
}

export async function verifyPortableCampaign(origin,projectId,state,token){
 const get=async path=>{const response=await fetch(origin+path,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);return response.json()};
 const native=`/api/management/projects/${projectId}`;
 const restored=(await get(native+'/widget-campaigns')).campaigns.find(row=>row.id===state.campaign.id);
 assert.deepEqual(restored,{...state.campaign,enabled:false},'campaign content and revision survive with execution disabled');
 assert.equal((await get(native+'/widget-settings')).campaignsEnabled,false,'restored widget never starts an archived campaign');
 assert.deepEqual((await get(`/api/dashboard/projects/${projectId}/reports?period=30`)).campaigns.find(row=>row.id===state.campaign.id),state.report,'consented attribution remains historical, within its original retention window');
}
