import {fileURLToPath} from 'node:url';
import {withoutLocalVariables} from '@runeditrun/rer/local/build';
import {buildEnvironment} from '@runeditrun/rer/local/environment';
import {createCommands} from '@runeditrun/rer/commands';
import {privateDirectory} from '@runeditrun/rer/private-files';
import {secretNames,variableNames} from './deployment/environment.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const bindings=new RegExp(`^(?:${[...secretNames,...variableNames,'APP_ORIGIN','H2H_LOCAL'].join('|')})$`);
const cancellation=new AbortController();
const stop=()=>cancellation.abort(new Error('Build stopped.'));
process.on('SIGINT',stop);process.on('SIGTERM',stop);
const store=await createCommands(await privateDirectory(root,['.seed','installer','build']),{logs:[]});
store.setCommandSignal(cancellation.signal);
try{
 await withoutLocalVariables(root,async({secrets})=>{
  store.addSecrets(secrets);
  const env=buildEnvironment(bindings);
  // vite build writes the migrations and public assets first (scripts/delivery/build-inputs.ts).
  for(const [command,args] of [['pnpm',['exec','vite','build']],[process.execPath,['scripts/delivery/build-inbox-shell.mjs']],[process.execPath,['scripts/delivery/build.mjs','--clean']]]){
   await store.run('Building application',command,args,{cwd:root,env,signal:cancellation.signal});
  }
 });
}finally{await store.closeCommands();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
