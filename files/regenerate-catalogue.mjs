// Run Edit Run fleet, 2026-11-17. Reproduce the prior round's byte binding.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const file='importers.json',registry=JSON.parse(await readFile(file,'utf8'))
for(const row of registry.importers){
 const evidence=row.evidence
 if(!evidence?.link?.startsWith('evidence:'))continue
 const bytes=await readFile(evidence.link.slice('evidence:'.length))
 evidence.size=bytes.length
 evidence.sha256=createHash('sha256').update(bytes).digest('hex')
 console.log(JSON.stringify({incumbent:row.incumbent,path:evidence.link,size:evidence.size,sha256:evidence.sha256}))
}
await writeFile(file,JSON.stringify(registry,null,2)+'\n')
