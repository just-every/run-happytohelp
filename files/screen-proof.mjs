import {createRuntime} from '/workspace/run-happytohelp/tests/helpers/emitted-runtime.mjs';
import {launchBrowser} from '/workspace/run-happytohelp/tests/journeys/kit/browser.mjs';
import {procedureDefinition} from '/workspace/run-happytohelp/tests/helpers/ai/procedures.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=process.env.HH_SCREEN_PACKET;
await mkdir(root,{recursive:true});
const runtime=await createRuntime(),browser=await launchBrowser();
let passed=false;
try{
 const {projectId,token}=await runtime.seedTenant({name:'Synthetic procedures screen proof',email:'synthetic-hh-screen-proof@example.test',allowedOrigin:runtime.origin});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}]);
 const response=await context.request.post(`${runtime.origin}/api/projects/${projectId}/procedures/refund/versions`,{data:procedureDefinition()});
 if(response.status()!==201)throw Error('Synthetic screen setup failed status='+response.status());
 const page=await context.newPage();
 await page.goto(`${runtime.origin}/projects/${projectId}/procedures`);
 await page.getByRole('button',{name:'refund · Version 1',exact:true}).waitFor();
 await page.getByRole('button',{name:'Save immutable version',exact:true}).waitFor();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`${root}/procedures-${width}.png`,fullPage:true});
 }
 await writeFile(`${root}/screen-proof.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{cwd:'/workspace/run-happytohelp',encoding:'utf8'}).trim(),widths:[1440,390],screen:'Procedure versions with saved refund Version 1 and editable draft',assertionWidth:1440,mobile:'screenshot only; no additional assertion matrix',outbound:'no provider configured or called',status:'success'},null,2)+'\n');
 await context.close();passed=true;
}finally{await browser.close();await runtime.close(passed)}
