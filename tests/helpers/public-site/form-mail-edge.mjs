// Provider edge for the configured-mail public-form presentation journey.
// No external service is contacted when editorial replies enqueue notifications.
export default async function formMailEdge(request) {
 const url=new URL(request.url);
 if(url.hostname==='api.resend.com'&&url.pathname==='/emails'&&request.method==='POST')return Response.json({id:crypto.randomUUID()});
 throw new Error('Unexpected public-form provider edge: '+url.hostname+url.pathname);
}
