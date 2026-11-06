import {appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import mailEdge from '../identity/mail-edge.mjs'
import {slackEdge} from './slack-edge.mjs'

// Browser runtime edge: Slack answers as documented and each direct message is
// recorded to slack.jsonl (as mail is to mail.jsonl) so the test reads the code
// Slack would show its member. Everything else is the existing mail edge.
const edge=slackEdge({installTeam:'T0BROWSER1'})
edge.members.U0OWNER001=edge.installTeam
edge.members.U0OUTSIDER='T0OTHER1'
export default async function slackBrowserEdge(request){
 if(new URL(request.url).hostname!=='slack.com')return mailEdge(request)
 const entry={body:await request.clone().text(),headers:Object.fromEntries(request.headers)},before=edge.posts().length
 const response=await edge.outbound(request,entry)
 for(const call of edge.posts().slice(before))await appendFile(join(process.cwd(),'slack.jsonl'),JSON.stringify(call.params)+'\n',{mode:0o600})
 return response
}
