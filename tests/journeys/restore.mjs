import test from 'node:test'
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {readArtifact} from '../helpers/artifact-payloads.mjs'
import {sha256} from '../helpers/recovery/snapshot.mjs'
import {recoveryComparison} from '../helpers/recovery/comparison.mjs'
import {independentRestoreJourney} from '../helpers/recovery/independent-journey.mjs'
import {platformArchiveJourney} from '../helpers/platform-archive.mjs'
import {rerMailArchiveJourney} from '../helpers/email/rer-archive.mjs'

test('a populated packaged install restores from its documented credential-free backup into a fresh destination with every row, object and metadata equal, sessions and password sign-in working, setup closed and delegated credentials gone',{timeout:10*60_000},async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'h2h-recovery-')),output=process.env.H2H_EVIDENCE_DIR?await mkdtemp(join(resolve(process.env.H2H_EVIDENCE_DIR),'recovery-')):scratch
 try{
  // The actual artifact this build emitted, identified by its bytes and migration ledger.
  const build=join(scratch,'build');await mkdir(build);await cp('delivery-artifact',join(build,'delivery-artifact'),{recursive:true})
  const source=join(build,'delivery-artifact/happytohelp-worker-artifact.json'),artifact=await readArtifact(source),bytes=await readFile(source)
  await writeFile(join(build,'delivery-artifact/artifact.json'),bytes)
  await writeFile(join(build,'build.json'),JSON.stringify({sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),artifactSha256:sha256(bytes),migrations:artifact.deploymentSpec.migrations.map(({name,sha256})=>({name,sha256}))}))
  await recoveryComparison(build,join(output,'proof'))
 }finally{await rm(scratch,{recursive:true,force:true})}
})

// Both archive variants retain business history and files while revoking live
// delegated authority; Managed mail also retains its delivery tombstones.
test('an independent packaged install opens setup only with its token, keeps media through the app, recovers search after a failed export, and restores native and Managed mail history without live mail authority or erased private MIME',{timeout:15*60_000},async()=>{
 for(const journey of [independentRestoreJourney,rerMailArchiveJourney])await journey()
})

test('a Platform-applied install exports an older archive into Platform and native destinations and restores its Managed data download natively, while unplaceable, cut-off or occupied-destination downloads and incomplete or multiple migration ledgers refuse without writes',{timeout:15*60_000},platformArchiveJourney)
