import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),revision='5dd6b3c170dd50e494008e4b8f80050a6ff36e14'
/** Real, bound Business CLI; fakes exist only at Business HTTP and OS storage.
 * No installed CLI update or copied Base tests enter the product. */
export async function businessLegacySender(h,fixture,mint){
 const scratch=await mkdtemp(join(tmpdir(),'.business-connect-hh-legacy-')),home=join(scratch,'home'),source=process.env.H2H_LEGACY_BASE_SOURCE??join(scratch,'base');let remote,proxy
 try{
  if(!process.env.H2H_LEGACY_BASE_SOURCE){await exec('git',['clone','--quiet','--depth=1','--filter=blob:none','--no-checkout','https://github.com/runeditrun/base.git',source],{timeout:120000});await exec('git',['-C',source,'fetch','--quiet','--depth=1','origin',revision],{timeout:120000});await exec('git',['-C',source,'sparse-checkout','set','bin','cli','composition','foundation/runtime','operations','modules/agent-door','modules/ai','modules/container','modules/delivery-producer','modules/demo','modules/dependencies','modules/deploy-kit','modules/job-queue','modules/operator-auth','modules/portability']);await exec('git',['-C',source,'checkout','--quiet','--detach','FETCH_HEAD'],{timeout:120000})}
  const actual=(await exec('git',['-C',source,'rev-parse','HEAD'])).stdout.trim();assert.equal(actual,revision,'Business sender must use the separately held, bound source')
  const {server}=await import(pathToFileURL(join(source,'cli/fixtures/business/server.mjs'))),{cli,connect,legacyTask}=await import(pathToFileURL(join(source,'cli/fixtures/business/legacy-cli.mjs')))
  remote=await server({after(){}})
  const plans=[],requests=[];let interrupt=true,interruptedChild,lastRefusal
  proxy=createServer(async(req,res)=>{try{const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts),parsed=body.length?JSON.parse(body):{},path=new URL(req.url,'http://localhost').pathname
   const response=await h.raw(path,{method:req.method,headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},...(body.length?{body:body.toString()}:{} )});requests.push({path,body:parsed,status:response.response.status});if(!response.response.ok)lastRefusal=response.data
   if(path.endsWith('/plan')&&response.response.ok)plans.push({...response.data,uploadId:parsed.uploadId})
   // The receiver committed this chunk but the sender lost its ACK. Resume
   // must inventory this same upload and send only the missing chunk indexes.
   if(interrupt&&path.endsWith('/uploads')&&parsed.name==='rer-segment'&&parsed.index===1){interrupt=false;interruptedChild.kill('SIGTERM');return}
   res.writeHead(response.response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(response.data))
  }catch{res.writeHead(500);res.end(JSON.stringify({error:'network_edge_failure'}))}})
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));remote.state.door={origin:`http://127.0.0.1:${proxy.address().port}`,mint,state:{plans}}
  const directory=join(scratch,'package');await mkdir(directory);for(const [file,bytes] of fixture.files)await writeFile(join(directory,file),bytes)
  const connected=await connect(home,remote);assert.equal(connected.code,0,connected.stderr)
  const added=await cli(home,['legacy-package','add',directory]);assert.equal(added.code,0,added.stderr)
  remote.state.exportVendor='happytohelp-legacy'
  remote.state.tasks.push(legacyTask('legacy-native-package'))
  const first=await cli(home,['run','--once'],{onSpawn:child=>{interruptedChild=child}});assert.equal(first.code,0,first.stderr);assert.equal(remote.state.released.reason,'handover')
  const before=requests.length,second=await cli(home,['run','--once']);assert.equal(second.code,0,second.stderr+JSON.stringify(lastRefusal));assert.equal(remote.state.phase,'done')
  assert.equal(plans.length,1);assert.equal(plans[0].summary.sourceRecords,fixture.sourceCount)
  const accepted=requests.slice(0,before).filter(row=>row.path.endsWith('/uploads')&&row.body.name==='rer-segment'),resumed=requests.slice(before).filter(row=>row.path.endsWith('/uploads'))
  assert.ok(resumed.some(row=>row.body.uploadId&&row.body.index===undefined),'resume inventories acknowledged and unacknowledged committed bytes')
  for(const row of accepted)assert.ok(!resumed.some(next=>next.body.uploadId===row.body.uploadId&&next.body.index===row.body.index),'resume must send missing indexes only')
  return plans[0]
 }finally{if(proxy)await new Promise(resolve=>proxy.close(resolve));if(remote)await remote.close();await rm(scratch,{recursive:true,force:true})}
}
