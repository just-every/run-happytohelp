import {createRequire} from 'node:module';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const server=fileURLToPath(new URL('../../dist/server/',import.meta.url));
const config=JSON.parse(await readFile(join(server,'wrangler.json'),'utf8'));
const chunks=await readdir(join(server,'assets'));
const modules=[config.main,...chunks.filter(name=>name.endsWith('.js')).map(name=>join('assets',name))]
 .map(name=>({type:'ESModule',path:join(server,name)}));

// Use Start's shell mode in a build-only isolate. The neutral mask path
// avoids application loaders and public contact decoration at the root URL.
const runtime=new Miniflare(convertV4MiniflareOptions({
 name:config.name,modulesRoot:server,modules,
 compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 bindings:{TSS_PRERENDERING:'true'},
}));
try{
 const response=await runtime.dispatchFetch('https://shell.invalid/login',{headers:{'X-TSS_SHELL':'true',Accept:'text/html'}});
 if(!response.ok)throw new Error(`Inbox shell render failed (${response.status})`);
 await writeFile(new URL('../../dist/client/_shell.html',import.meta.url),await response.text());
}finally{await runtime.dispose()}
