import engineering from '../escalations/outbound.mjs'
// The only fake is Penny's network boundary; the app and storage are the emitted Worker.
export default async request=>{
 const url=new URL(request.url)
 if(url.origin==='https://penny.example.com'&&request.method==='POST'&&/^\/api\/v1\/requests\/[a-z0-9-]+\/proxy-votes$/.test(url.pathname)){
  const data=await request.json()
  if(typeof data.source!=='string'||typeof data.sourceUrl!=='string'||!data.contact&&!data.requesterId)return Response.json({error:'invalid_source'},{status:400})
  return Response.json({requesterId:'00000000000000000000000001',created:true})
 }
 return engineering(request)
}
