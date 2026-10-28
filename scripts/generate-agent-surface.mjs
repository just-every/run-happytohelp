import {build} from 'esbuild'
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
const directory=await mkdtemp(join(tmpdir(),'h2h-agent-registry-'))
try{
 const output=join(directory,'registry.mjs')
 await build({stdin:{contents:`import {happyTools,notTools} from './src/edition/agent-door/tools.ts';import {happyResources} from './src/edition/agent-door/resources.ts';const registry={tools:happyTools({}).map(({name,scope,readOnly,classes,clauses,inputSchema,outputSchema})=>({name,scope,readOnly,classes,clauses,inputSchema,outputSchema})),notTools,resources:happyResources({}).map(r=>r.uriTemplate)};export default {fetch(){return Response.json(registry)}};`,resolveDir:process.cwd()},outfile:output,bundle:true,format:'esm',platform:'node',target:'es2022',logLevel:'silent',external:['node:*','cloudflare:*']})
 const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}))
 const script=await readFile(output,'utf8'),mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-09-14',compatibilityFlags:['nodejs_compat'],outboundService:()=>new Response(null,{status:502})}))
 let registry
 try{registry=await (await mf.dispatchFetch('https://registry.invalid')).json()}finally{await mf.dispose()}
 const journey=JSON.parse(await readFile('tests/helpers/agent-door/surface-journey.json','utf8'))
 const surface={schema:'rer-agent-surface/1',seed:'happytohelp',specialist:'support agent',...registry,tools:[...registry.tools,{name:'happytohelp.events.list',scope:'events:read',readOnly:true,classes:['standard'],clauses:['BASE-AGENT-010']}],...journey}
 await writeFile('agent-surface.json',JSON.stringify(surface,null,2)+'\n')
}finally{await rm(directory,{recursive:true,force:true})}
