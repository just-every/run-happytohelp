import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {parseJsonc} from '@runeditrun/rer/jsonc'

// An offline D1 inspection owner, opened only after rer stops its server. Match
// the existing independent-storage harness: no app assets, DOs, queues or vars.
export async function recoveryStorage(root,visit){
 const config=parseJsonc(await readFile(join(root,'wrangler.jsonc'),'utf8'))
 const configPath=join(root,'.seed/identity-recovery.storage.json')
 await writeFile(configPath,JSON.stringify({name:config.name,compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,d1_databases:config.d1_databases}))
 const {getPlatformProxy}=createRequire(join(root,'package.json'))('wrangler')
 const proxy=await getPlatformProxy({configPath,envFiles:[],remoteBindings:false,persist:{path:join(root,'.wrangler/state/v3')}})
 try{return await visit(proxy.env)}finally{await proxy.dispose()}
}
