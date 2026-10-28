import {appendFile} from 'node:fs/promises'
import {join} from 'node:path'

// Capture only the mail provider edge; sign-in issuance and redemption stay native.
export default async function mailEdge(request){
 if(new URL(request.url).origin!=='https://api.resend.com')throw Error('Unexpected mail provider request')
 await appendFile(join(process.cwd(),'mail.jsonl'),JSON.stringify(await request.json())+'\n',{mode:0o600})
 return Response.json({id:crypto.randomUUID()})
}
