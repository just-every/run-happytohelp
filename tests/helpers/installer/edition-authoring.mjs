import assert from 'node:assert/strict'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile,cp,chmod,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {VERSION} from '../../../scripts/edition-authoring/manifest.mjs'

// Public CLI doors against synthetic local repositories; no upstream acquisition,
// provider credentials, private source, or application implementation is faked.
export async function editionAuthoringJourney(){
 const scratch=await mkdtemp(join(tmpdir(),'h2h-edition-authoring-')),origin=join(scratch,'origin'),edition=join(scratch,'edition'),output=join(scratch,'release')
 const cli=resolve('scripts/edition-authoring/cli.mjs'),license=await readFile('LICENSE','utf8')
 const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 // Reuse the candidate's permitted identity for temporary commits, including CI
 // checkouts where Git has no configured account. This reads identity only.
 const authorName=git(process.cwd(),'log','-1','--format=%an'),authorEmail=git(process.cwd(),'log','-1','--format=%ae')
 const identity={GIT_AUTHOR_NAME:authorName,GIT_AUTHOR_EMAIL:authorEmail,GIT_COMMITTER_NAME:authorName,GIT_COMMITTER_EMAIL:authorEmail}
 const commit=cwd=>execFileSync('env',[...['GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL'].map(key=>{assert.ok(identity[key]);return key+'='+identity[key]}),'git','-C',cwd,'commit','-qm','Synthetic authoring capability'],{stdio:'pipe'})
 const run=(cwd,...args)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'})
 const ok=(cwd,...args)=>{const result=run(cwd,...args);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout)}
 const refused=(cwd,...args)=>{const result=run(cwd,...args);assert.equal(result.status,1,result.stdout);return result}
 try{
  for(const dir of [origin,edition]){await mkdir(dir);git(dir,'init','-q');git(dir,'config','user.name',authorName);git(dir,'config','user.email',authorEmail)}
  await mkdir(join(origin,'capability'));await writeFile(join(origin,'capability/run.mjs'),'#!/usr/bin/env node\nconsole.log(2 * 3)\n');await chmod(join(origin,'capability/run.mjs'),0o755);await writeFile(join(origin,'capability/LICENSE'),license)
  await mkdir(join(origin,'private-fixtures'));await writeFile(join(origin,'private-fixtures/customer.txt'),'synthetic-happytohelp-1')
  git(origin,'add','.');commit(origin);const revision=git(origin,'rev-parse','HEAD')
  await cp(join(origin,'capability'),join(edition,'app'),{recursive:true})
  const recipe={schemaVersion:1,id:'synthetic/happytohelp',toolchain:{id:'runeditrun/edition-authoring',version:VERSION},components:[{id:'synthetic/capability',role:'module',source:{kind:'local',paths:['app']}}]}
  await writeFile(join(edition,'edition.json'),JSON.stringify(recipe));git(edition,'add','.')
  ok(edition,'record-base','app','capability',revision,'--base',origin)
  const record=await readFile(join(edition,'base-copies.json'),'utf8')
  assert.equal(ok(edition,'verify-base','--base',origin).ok,true)
  await writeFile(join(edition,'app/run.mjs'),'console.log(99)\n')
  assert.ok(JSON.parse(refused(edition,'verify-base','--base',origin).stdout).drift.some(row=>row.kind==='modified'))
  await cp(join(origin,'capability/run.mjs'),join(edition,'app/run.mjs'));await chmod(join(edition,'app/run.mjs'),0o644)
  assert.ok(JSON.parse(refused(edition,'verify-base','--base',origin).stdout).drift.some(row=>row.kind==='mode'))
  await chmod(join(edition,'app/run.mjs'),0o755)
  // A forged record may match local bytes and still disagree with its claimed origin.
  const wrong=JSON.parse(record);wrong.copies[0].originPath='private-fixtures';await writeFile(join(edition,'base-copies.json'),JSON.stringify(wrong))
  assert.ok(JSON.parse(refused(edition,'verify-base','--base',origin).stdout).drift.some(row=>row.kind==='origin-missing'))
  await writeFile(join(origin,'capability/run.mjs'),'#!/usr/bin/env node\nconsole.log(8)\n');git(origin,'add','.');commit(origin)
  const wrongBytes=JSON.parse(record);wrongBytes.copies[0].revision=git(origin,'rev-parse','HEAD');await writeFile(join(edition,'base-copies.json'),JSON.stringify(wrongBytes))
  assert.ok(JSON.parse(refused(edition,'verify-base','--base',origin).stdout).drift.some(row=>row.kind==='origin-mismatch'))
  const wrongMode=JSON.parse(record);wrongMode.copies[0].modes['app/run.mjs']='100644';await writeFile(join(edition,'base-copies.json'),JSON.stringify(wrongMode));await chmod(join(edition,'app/run.mjs'),0o644)
  assert.ok(JSON.parse(refused(edition,'verify-base','--base',origin).stdout).drift.some(row=>row.kind==='origin-mode'))
  await chmod(join(edition,'app/run.mjs'),0o755);await writeFile(join(edition,'base-copies.json'),record)
  // A source declaration without an immutable origin cannot acquire authority.
  recipe.components[0].source.origin={repository:origin,revision:'main'};await writeFile(join(edition,'edition.json'),JSON.stringify(recipe));refused(edition,'lock')
  delete recipe.components[0].source.origin;await writeFile(join(edition,'edition.json'),JSON.stringify(recipe))
  git(edition,'add','.');ok(edition,'lock');git(edition,'add','.');commit(edition)
  // Local credentials and omitted private fixtures stay outside the committed release.
  await writeFile(join(edition,'.git/info/exclude'),'.env\nprivate-fixtures/\n')
  await writeFile(join(edition,'.env'),'SYNTHETIC_LOCAL_ONLY=synthetic-happytohelp-2\n');await mkdir(join(edition,'private-fixtures'));await writeFile(join(edition,'private-fixtures/local.txt'),'synthetic-happytohelp-3')
  ok(edition,'release',output)
  git(output,'config','user.name',authorName);git(output,'config','user.email',authorEmail)
  assert.equal(Number(execFileSync(process.execPath,[join(output,'app/run.mjs')],{encoding:'utf8'})),6)
  assert.equal(await readFile(join(output,'app/LICENSE'),'utf8'),license,'the capability retains its license')
  for(const privatePath of ['.env','private-fixtures/local.txt','private-fixtures/customer.txt'])await assert.rejects(readFile(join(output,privatePath)),{code:'ENOENT'})
  assert.equal(ok(output,'check').ok,true);assert.equal(ok(output,'receipt',output+'.release.json').ok,true)
  await writeFile(join(edition,'app/run.mjs'),'console.log(7)\n')
  refused(edition,'release',join(scratch,'stale-release'))
  // Refresh the lock so only the clean-committed-source guard can refuse this release.
  ok(edition,'lock');assert.equal(ok(edition,'check').ok,true)
  assert.match(refused(edition,'release',join(scratch,'dirty-release')).stderr,/clean committed edition/)
 }finally{await rm(scratch,{recursive:true,force:true})}
}
