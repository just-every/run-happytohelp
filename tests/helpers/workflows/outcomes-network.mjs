// Paid/network edge only. Record every attempted external request outside source.
import {appendFile} from 'node:fs/promises'
import {join} from 'node:path'
export default async request=>{
 const host=new URL(request.url).hostname,body=request.method==='GET'?null:await request.clone().json()
 await appendFile(join(process.cwd(),'automation-edge.jsonl'),JSON.stringify({host,body})+'\n')
 if(host==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
 if(host==='api.resend.com')return Response.json({id:'synthetic-workflow-delivery'})
 throw Error('Unexpected automation network destination: '+host)
}
