// Test network edge only: no external service is contacted by the emitted Worker.
const deliveries=new Map();
export default async request=>{
 const url=new URL(request.url);
 if(url.hostname==='graph.facebook.com'){if(request.method==='GET')return Response.json({data:[{id:'synthetic-happytohelp-template',name:'support_update',status:'APPROVED',language:'en_US',category:'UTILITY',components:[{type:'BODY',text:'Your order {{1}} is ready.'}]}]});return Response.json({messages:[{id:'synthetic-happytohelp-outbound'}]});}
 if(url.pathname==='/api/auth.test'){const width=(request.headers.get('authorization')||'').split('-').at(-1);return Response.json({ok:true,team_id:'synthetic-happytohelp-slack-'+width,user_id:'U12345'},{headers:{'x-oauth-scopes':'chat:write,channels:history,files:read,im:history'}});}
 if(url.pathname==='/api/conversations.info')return Response.json({ok:true,channel:{id:url.searchParams.get('channel'),is_member:true,is_ext_shared:true}});
 if(url.pathname==='/api/chat.postMessage'&&JSON.parse(await request.clone().text()).thread_ts)return Response.json({ok:true,ts:'1710000000.3'});
 if(url.hostname==='messaging.twilio.com'){const token=request.headers.get('authorization')||'';const account=Buffer.from(token.slice(6),'base64').toString().split(':')[0];return Response.json(url.pathname.endsWith('/PhoneNumbers')?{phone_numbers:[{account_sid:account,phone_number:'+12025550123'}]}:{usa2p:[{account_sid:account,campaign_status:'VERIFIED'}]});}
 if(url.hostname==='api.twilio.com')return Response.json({sid:'synthetic-happytohelp-3'});
 if(url.origin==='https://receiver.example.com'&&url.pathname==='/browser-resend'){const id=request.headers.get('webhook-id'),count=deliveries.get(id)||0;deliveries.set(id,count+1);return new Response(count<2?'':null,{status:count<2?500:204})}
 if(url.hostname==='hooks.slack.com'||url.origin==='https://receiver.example.com'||url.href==='https://slack.com/api/chat.postMessage')return new Response('',{status:401});
 throw Error('External request prohibited');
};
