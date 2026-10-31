import {appendFile} from 'node:fs/promises'
// Network edge only. The emitted application still generates and redeems every
// email link; no mail leaves the test runtime and unexpected providers fail.
const capture=new URL(import.meta.url).searchParams.get('capture')
export default async request=>{
 if(request.url==='https://api.resend.com/emails'){
  const message=await request.json()
  await appendFile(capture,JSON.stringify(message)+'\n')
  return Response.json({id:'synthetic-portal-mail'})
 }
 if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
 throw Error('Unexpected portal provider request')
}
