#!/usr/bin/env node
// This edition retains its legacy clause layout. Generate evidence views directly
// from it without rewriting any requirement, acceptance point or clause status.
import {readFile,writeFile,mkdir} from 'node:fs/promises'

const source=await readFile('CONTRACT.md','utf8')
const marker='<!-- Generated from CONTRACT.md by scripts/contract-docs.mjs. Edit CONTRACT.md, then regenerate. -->'
const rows=new Map(source.split('\n').filter(line=>/^\| `[^`]+` \|/.test(line)).map(line=>{
 const cells=line.replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(cell=>cell.trim())
 return [cells[0].replaceAll('`',''),{title:cells[1],kind:cells[2],status:cells[3],evidence:cells[4],gap:cells[5]}]
}))
const clauses=[...source.matchAll(/^- \*\*([A-Z][A-Z0-9.-]+) — ([\s\S]*?)(?=\n- \*\*[A-Z][A-Z0-9.-]+ — |\n## |(?![\s\S]))/gm)].map(match=>({id:match[1],text:'- **'+match[1]+' — '+match[2].trim()}))
if(!clauses.length||clauses.length!==rows.size)throw Error('Every contract clause must have exactly one status row')
for(const {id,text} of clauses){
 if(!rows.has(id)||!['done','partial','missing'].includes(rows.get(id).status))throw Error('Missing or invalid status for '+id)
 if(!text.includes('**Acceptance evidence:**'))throw Error('Missing acceptance evidence for '+id)
}
const summary=source.match(/\| Clauses \| Done \| Partial \| Missing \| Total \|[\s\S]*?(?=\n\n)/)?.[0]
if(!summary)throw Error('Missing contract summary')
const progress=['Published','Target and push further','All'].map(label=>{
 const selected=[...rows.values()].filter(row=>label==='All'||(label==='Published'?row.kind==='published':row.kind!=='published'))
 return `| ${label} | ${['done','partial','missing'].map(status=>selected.filter(row=>row.status===status).length).join(' | ')} | ${selected.length} |`
})
if(!progress.every(row=>summary.includes(row)))throw Error('Contract summary does not match clause statuses')
const acceptance=[marker,'# HappyToHelp acceptance','Requirements, acceptance evidence and statuses below come from [CONTRACT.md](CONTRACT.md). A done status retains the source contract’s qualification boundaries; fixtures do not establish live provider delivery.',summary]
const claims=[marker,'# HappyToHelp claims','Generated evidence index. [CONTRACT.md](../CONTRACT.md) is the only requirement and status source.','| Clause | Title | Status | Evidence | Gap |','| --- | --- | --- | --- | --- |']
for(const {id,text} of clauses){
 const row=rows.get(id)
 acceptance.push(`## ${id} — ${row.title}`,`Status: **${row.status}** (${row.kind}).`,text,`**Repository evidence:** ${row.evidence||'None recorded.'}`,`**Qualification boundary:** ${row.gap||'See the source contract and its standing boundaries.'}`)
 claims.push(`| ${id} | ${row.title} | ${row.status} | ${row.evidence} | ${row.gap} |`)
}
const outputs={'ACCEPTANCE.md':acceptance.join('\n\n')+'\n','docs/CLAIMS.md':claims.join('\n')+'\n'}
const command=process.argv[2]
if(command==='write'){
 await mkdir('docs',{recursive:true})
 for(const [file,text] of Object.entries(outputs))await writeFile(file,text)
}else if(command==='check'){
 for(const [file,text] of Object.entries(outputs))if(await readFile(file,'utf8')!==text)throw Error(file+' is stale; run node scripts/contract-docs.mjs write')
}else throw Error('Usage: node scripts/contract-docs.mjs write|check')
console.log('Contract documents '+(command==='write'?'generated':'current')+' ('+clauses.length+' clauses).')
