import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import slackBrowserEdge from './slack-browser-edge.mjs'
// Every non-Microsoft request goes to the unchanged Slack/mail fixture.
export default async function notifyBrowserEdge(request){
 const host=new URL(request.url).hostname
 if(host==='login.botframework.com')return Response.json({keys:[JSON.parse(await readFile(join(process.cwd(),'teams-jwk.json'),'utf8'))]})
 if(host==='login.microsoftonline.com')return Response.json({access_token:'synthetic-hh-browser-access'})
 if(host==='smba.trafficmanager.net')return Response.json({id:'synthetic-hh-browser-activity'})
 return slackBrowserEdge(request)
}
