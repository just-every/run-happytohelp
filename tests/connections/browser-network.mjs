// Test network edge only: no external service is contacted by the emitted Worker.
const deliveries=new Map();
export default async request=>{
 const url=new URL(request.url);
 if(url.origin==='https://receiver.example.com'&&url.pathname==='/browser-resend'){const id=request.headers.get('webhook-id'),count=deliveries.get(id)||0;deliveries.set(id,count+1);return new Response(count<2?'':null,{status:count<2?500:204})}
 if(url.origin==='https://hooks.slack.com')return new Response('ok',{status:200});
 if(url.origin==='https://receiver.example.com'||url.href==='https://slack.com/api/chat.postMessage')return new Response('',{status:401});
 throw Error('External request prohibited');
};
