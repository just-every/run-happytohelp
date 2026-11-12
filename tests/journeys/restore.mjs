import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {readArtifact} from '../helpers/artifact-payloads.mjs'
import {sha256} from '../helpers/recovery/snapshot.mjs'
import {recoveryComparison} from '../helpers/recovery/comparison.mjs'
import {recoveryRestoreJourney} from '../helpers/identity/recovery-restore/journey.mjs'
import {excludedTable} from '@runeditrun/rer/modules/portability/catalogue'
import {archivePolicy} from '../../scripts/installer/portability-policy.mjs'
import {inboxRebuildSql} from '../../scripts/installer/inbox-entries-sql.mjs'
import {cutoverRebuildSql} from '../../scripts/installer/cutover-bounds-sql.mjs'
import {contactTallyRebuildSql} from '../../scripts/installer/contact-bounds-sql.mjs'

test('a populated packaged install restores from its documented credential-free backup into a fresh destination with every row, object and metadata equal, sessions and password sign-in working, setup closed and delegated credentials gone',{timeout:20*60_000},async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'h2h-recovery-')),output=process.env.H2H_EVIDENCE_DIR?await mkdtemp(join(resolve(process.env.H2H_EVIDENCE_DIR),'recovery-')):scratch
 try{
  // The actual artifact this build emitted, identified by its bytes and migration ledger.
  const build=join(scratch,'build');await mkdir(build);await cp('delivery-artifact',join(build,'delivery-artifact'),{recursive:true})
  const source=join(build,'delivery-artifact/happytohelp-worker-artifact.json'),artifact=await readArtifact(source),bytes=await readFile(source)
  await writeFile(join(build,'delivery-artifact/artifact.json'),bytes)
  await writeFile(join(build,'build.json'),JSON.stringify({sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),artifactSha256:sha256(bytes),migrations:artifact.deploymentSpec.migrations.map(({name,sha256})=>({name,sha256}))}))
  await recoveryRestoreJourney()
  await recoveryComparison(build,join(output,'proof'))
 }finally{await rm(scratch,{recursive:true,force:true})}
})

// A table every import rebuilds from the restored rows must not travel: its rows follow write history, so a restored export would order them differently.
test('every derived table an import rebuilds stays out of the archive, so a restored export equals its source',()=>{
 const rebuilt=[...new Set([inboxRebuildSql,cutoverRebuildSql,contactTallyRebuildSql].flatMap(sql=>[...sql.matchAll(/DELETE FROM (\w+)/g)].map(match=>match[1])))]
 assert.ok(rebuilt.length,'the rebuild statements name the derived tables')
 for(const table of rebuilt)assert.ok(excludedTable(table,archivePolicy),table+' is rebuilt by import and is not archived')
})
