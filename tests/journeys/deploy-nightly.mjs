import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {run as rer} from '../helpers/rer-command.mjs'
const scratch=name=>mkdtemp(join(tmpdir(),name))

test('a native owner whose mail provider has no key is told EMAIL_API_KEY by the real rer deploy: the dry run still completes offline and lists it, and a real deploy refuses before building',async()=>{
 const root=await scratch('h2h-native-mail-')
 try{
  // The real command and build, with every provider request refused and recorded.
  const network=join(root,'network.mjs'),calls=join(root,'requests.txt')
  await writeFile(calls,'');await writeFile(network,`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(calls)},'request\\n');throw Error('Deploy checks make no provider requests')}`)
  const inputs={OWNER_EMAIL:'owner@dry-run.example.com',MAIL_PROVIDER:'direct',EMAIL_PROVIDER:'resend',EMAIL_FROM:'Support <support@dry-run.example.test>',EMAIL_API_KEY:'',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:'',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${pathToFileURL(network).href}`].filter(Boolean).join(' ')}
  const dry=(await rer(process.cwd(),['deploy','--dry-run'],0,{env:inputs})).events.at(-1)
  assert.deepEqual([dry.ok,dry.dryRun,dry.deployed,dry.providerChecked],[true,true,false,false])
  assert.match(dry.neededForRealDeploy.join('\n'),/\bEMAIL_API_KEY\b/)
  const refused=(await rer(process.cwd(),['deploy'],3,{env:inputs})).events.find(event=>event.event==='error')
  assert.match(refused.message,/\bEMAIL_API_KEY\b/)
  assert.equal(await readFile(calls,'utf8'),'','neither door makes a provider request')
 }finally{await rm(root,{recursive:true,force:true})}
})

test('a native owner switches between SendGrid and the relay through rer deploy',async()=>{
 const root=process.cwd(),fixture=await scratch('h2h-mail-switch-')
 const environment='mail-switch-'+process.pid,record=join(root,'.rer','deploy',environment+'.json')
 const held=join(fixture,'held.json'),inputs=join(fixture,'deploy.env'),loader=join(fixture,'loader.mjs')
 const ownerModule=import.meta.resolve('@runeditrun/rer/internal/modules/deploy-kit/owner-cli.mjs')
 try{
  await mkdir(join(root,'.rer','deploy'),{recursive:true})
  await writeFile(record,JSON.stringify({receipt:{secrets:['MAIL_API_KEY']},ownerClaim:{outcome:'kept'}}),{mode:0o600})
  await writeFile(held,JSON.stringify({key:'fixture-sendgrid',resets:0}))
  await writeFile(loader,`import {registerHooks} from 'node:module'
 registerHooks({resolve(specifier,context,next){
  const result=next(specifier,context)
  return result.url===${JSON.stringify(ownerModule)}?{url:new URL('./owner.mjs',import.meta.url).href,shortCircuit:true}:result
 }})
 `)
  await writeFile(join(fixture,'owner.mjs'),`import {readFile,writeFile} from 'node:fs/promises'
 import {join} from 'node:path'
 export * from ${JSON.stringify(ownerModule+'?real')}
 const read=async path=>JSON.parse(await readFile(path,'utf8'))
 const record=${JSON.stringify(record)},held=${JSON.stringify(held)}
 export async function main(args,env,{cwd}){
  const field=name=>args[args.indexOf(name)+1]
  const state=await read(record), worker=await read(held)
  const origin='https://mail-switch.example.invalid'
  if(args[0]==='inspect')return {origin,liveSecrets:['MAIL_API_KEY'],ownerClaim:state.ownerClaim}
  if(args[0]==='health'||args.includes('--unset')&&field('--unset')==='H2H_SETUP_TOKEN')return {ok:true}
  const declaration=await read(join(cwd,field('--declaration')))
  const binding=declaration.secrets.find(item=>item.binding==='MAIL_API_KEY')
  if(args[0]==='secret'&&args.includes('--set')&&field('--set')===binding.binding){
   await writeFile(held,JSON.stringify({key:env[binding.environment],resets:worker.resets+1}))
   return {ok:true}
  }
  if(args[0]!=='deploy')throw Error('Unexpected operation at the owner command edge')
  // The provider upload inherits the key it already holds.
  await writeFile(record,JSON.stringify({...state,receipt:{...state.receipt,origin}}))
  return {origin,sentSecrets:[],ownerClaim:state.ownerClaim}
 }
 `)
  const deploy=async choice=>{
   const values={OWNER_EMAIL:'owner@127.0.0.1',CLOUDFLARE_ACCOUNT_ID:'fixture-account',CLOUDFLARE_API_TOKEN:'fixture-token',...choice}
   await writeFile(inputs,Object.entries(values).map(([name,value])=>name+'='+value).join('\n')+'\n',{mode:0o600})
   const command=await rer(root,['deploy','--environment',environment,'--env-file',inputs],0,{
    env:{CLOUDFLARE_API_TOKEN:'',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${pathToFileURL(loader).href}`].filter(Boolean).join(' ')}
   })
   assert.equal(command.events.at(-1).deployed,true)
   return JSON.parse(await readFile(held,'utf8'))
  }
  // Loopback mailboxes satisfy the deploy input format in this offline journey.
  const sender='support@127.0.0.1'
  const own={MAIL_MODE:'own',MAIL_PROVIDER:'sendgrid',EMAIL_PROVIDER:'sendgrid',EMAIL_FROM:sender,EMAIL_API_KEY:'fixture-sendgrid',MAIL_FROM:'',MAIL_API_KEY:''}
  const relay={MAIL_MODE:'rer',MAIL_PROVIDER:'rer',MAIL_RECIPIENTS:'owner',MAIL_FROM:sender,MAIL_RELAY_URL:'https://relay.example.invalid/api/managed-mail/send',MAIL_API_KEY:'fixture-relay',EMAIL_API_KEY:'fixture-unused-native'}
  assert.deepEqual(await deploy(own),{key:'fixture-sendgrid',resets:0})
  assert.deepEqual(await deploy(relay),{key:'fixture-relay',resets:1})
  assert.deepEqual(await deploy(relay),{key:'fixture-relay',resets:1})
  assert.deepEqual(await deploy(own),{key:'fixture-sendgrid',resets:2})
 }finally{
  await rm(record,{force:true})
  await rm(fixture,{recursive:true,force:true})
 }
})
