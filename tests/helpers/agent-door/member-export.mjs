import {writeFile,readFile,mkdir,symlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'

// Export the actual local D1 through Wrangler while the app is stopped. The
// output is synthetic fixture data and is removed with the app's scratch state.
export async function memberExport(app){
 return app.withStopped(async()=>{
  const config=join(app.directory,'export.wrangler.json'),output=join(app.directory,'member.sql')
  await mkdir(join(app.directory,'.wrangler/state'),{recursive:true})
  try{await symlink(join(app.directory,'state'),join(app.directory,'.wrangler/state/v3'),'dir')}catch(error){if(error.code!=='EEXIST')throw error}
  await writeFile(config,JSON.stringify({name:'h2h-member-export',compatibility_date:'2026-09-14',d1_databases:[{binding:'DB',database_name:'h2h-app',database_id:'h2h-app'}]}))
  await new Promise((done,reject)=>{
   const child=spawn(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','export','DB','--local','--config',config,'--output',output,...['users','memberships','identity_tokens','context_tracked_events','h2h_agent_operations','agent_door_agents','agent_door_audit','agent_door_events','agent_door_calls','agent_door_approvals','agent_door_reviews','bs_team','bs_settings'].flatMap(table=>['--table',table])],{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'}})
   let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data)
   child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error('Native D1 export failed: '+log)))
  })
  return readFile(output,'utf8')
 })
}
