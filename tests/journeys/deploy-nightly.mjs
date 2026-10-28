import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
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
