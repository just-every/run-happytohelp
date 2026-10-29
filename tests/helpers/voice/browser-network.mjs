// Telephony fake at the network boundary; no paid service or real account.
export default async request=>{
 const url=new URL(request.url)
 if(url.hostname!=='api.twilio.com')throw Error('Unexpected voice provider')
 if(url.pathname.includes('/IncomingPhoneNumbers/'))return Response.json({sid:'synthetic-happytohelp-3',account_sid:'synthetic-happytohelp-2',phone_number:'+12025550101'})
 if(url.pathname.endsWith('.mp3'))return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}})
 return Response.json({sid:'synthetic-happytohelp-4'},{status:503})
}
