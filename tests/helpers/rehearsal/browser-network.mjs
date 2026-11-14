import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {fakeZendesk} from '../../move-in/zendesk-pull-fixture.mjs'
const zendesk=fakeZendesk({attachments:true});let pulls=0
// The synthetic provider outlives Worker restarts just as a remote account does.
const stateFile=JSON.parse(process.env.H2H_TEST_BINDINGS||'{}').REHEARSAL_PROVIDER_STATE
if(stateFile){
 try{const saved=JSON.parse(await readFile(stateFile,'utf8'));for(const key of ['access','refresh'])zendesk.state[key]=new Set(saved[key]);zendesk.state.issued=saved.issued;zendesk.state.repeat=saved.repeat;pulls=saved.pulls}catch(error){if(error.code!=='ENOENT')throw error}
}
// Only the source/provider network edge is synthetic. PKCE state, callback,
// connection, review, custody, mapping, consent and writes remain the product.
export default async function network(request){
 const url=new URL(request.url)
 if(url.pathname==='/oauth/tokens'){
  const body=await request.clone().json()
  if(body.grant_type==='authorization_code'){
   assert.match(body.code,/^synthetic-browser-code-/)
   zendesk.state.grants.set(body.code,{challenge:createHash('sha256').update(body.code_verifier).digest('base64url'),redirect_uri:body.redirect_uri})
  }
 }
 if(url.pathname==='/api/v2/ticket_fields.json'&&++pulls>1)zendesk.state.repeat=true
 const response=await zendesk.handler(request)
 if(stateFile)await writeFile(stateFile,JSON.stringify({access:[...zendesk.state.access],refresh:[...zendesk.state.refresh],issued:zendesk.state.issued,repeat:zendesk.state.repeat,pulls}))
 return response
}
