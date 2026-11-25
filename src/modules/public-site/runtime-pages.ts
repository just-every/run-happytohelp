import contractSource from '../../../CONTRACT.md?raw'
import {parseContract} from '../../site/base/seed-contract.mjs'
import {runPageHtml} from '../../site/base/run-site'
import {contractPageHtml} from '../../site/base/contract-page'
import {identity} from '../../site/identity'
import {run} from '../../site/run'
import {withReleaseLaunch} from '../../site/release-launch'

const pages=new Map<string,string>()
let contract:ReturnType<typeof parseContract>|undefined

/** The app serves the same maintained renderers as the separately built public site. */
export function runtimeSitePage(request:Request):Response|null{
 const path=new URL(request.url).pathname
 if(!['GET','HEAD'].includes(request.method)||!['/run','/contract'].includes(path))return null
 let html=pages.get(path)
 if(html===undefined&&request.method==='GET'){
  contract??=parseContract(contractSource)
  html=path==='/run'?withReleaseLaunch(runPageHtml(identity,run,contract)):contractPageHtml(identity,run,contract)
  pages.set(path,html)
 }
 return new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8'}})
}
