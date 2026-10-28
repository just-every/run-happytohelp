import type {Env} from '../../platform/env'
/** Hosting establishes DNS/TLS and the exact hostname-to-workspace allowlist.
 * A support lead may publish only within that existing deployment authority. */
export async function approvedHelpHosts(env:Env,projectId:string){
 let hosts:Record<string,unknown>;try{hosts=JSON.parse(typeof env.PUBLIC_HELP_HOSTS==='string'?env.PUBLIC_HELP_HOSTS:'{}')}catch{return []}
 if(!hosts||typeof hosts!=='object'||Array.isArray(hosts))return []
 const aliases=(await env.DB.prepare('SELECT slug FROM public_project_aliases WHERE project_id=?').bind(projectId).all<{slug:string}>()).results.map(r=>r.slug)
 let appHost='';try{appHost=new URL(typeof env.APP_ORIGIN==='string'?env.APP_ORIGIN:'').hostname}catch{}
 return Object.entries(hosts).filter(([host,key])=>host!==appHost&&host===host.toLowerCase()&&(host==='localhost'||/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))&&typeof key==='string'&&(key===projectId||aliases.includes(key))).map(([host])=>host).sort()
}
