#!/usr/bin/env node
import {readdir} from 'node:fs/promises'
import {spawn} from 'node:child_process'

const mode=process.argv[2]
if(!['routes','browsers','extended'].includes(mode))throw Error('Usage: node scripts/test-journeys.mjs routes|browsers|extended')
const files=(await readdir('tests/journeys')).filter(file=>file.endsWith('.mjs')).sort()
const selected=mode==='routes'?files.filter(file=>!/-browser\.mjs$|-(nightly|live)\.mjs$/.test(file))
 :mode==='browsers'?files.filter(file=>file.endsWith('-browser.mjs'))
 :files.filter(file=>['data-upgrade-nightly.mjs','move-in-capacity-nightly.mjs','reports-nightly.mjs'].includes(file))
const concurrency=process.env.H2H_TEST_CONCURRENCY??'2'
if(!['1','2'].includes(concurrency))throw Error('H2H_TEST_CONCURRENCY must be 1 or 2')
const args=['--test',`--test-concurrency=${concurrency}`,...selected.map(file=>'tests/journeys/'+file)]
if(mode==='routes')args.push('tests/sanity/ai/admission.mjs')
const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env})
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal))
child.once('error',error=>{console.error(error);process.exitCode=1})
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0)})
