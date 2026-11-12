import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {missing} from '@runeditrun/rer/errors';
import {main as owner} from '@runeditrun/rer/internal/modules/deploy-kit/owner-cli.mjs';
import {deployEnvironment} from '@runeditrun/rer/internal/cli/deploy-inputs.mjs';
import {committedSource} from '@runeditrun/rer/internal/cli/deploy-source.mjs';
import {deployOwnerInput} from '@runeditrun/rer/internal/cli/deploy-owner-input.mjs';
import {claimHostedOwner} from '@runeditrun/rer/internal/cli/deploy-owner.mjs';
import {checkHostedSetup} from '@runeditrun/rer/internal/cli/deploy-setup.mjs';
import {withoutLocalSettings,refuseLocalEnvOutput} from '@runeditrun/rer/internal/cli/local-env.mjs';
import {keptSecrets,keepSecrets} from '@runeditrun/rer/internal/cli/deploy-secrets.mjs';
import {validateRuntimeEnvironment} from '../deployment/environment.mjs';

/** Native Mailgun uses the seed's adapter and validation. The shared mail
 * preflight has no Mailgun entry; resource ownership and publication still use
 * the same deploy kit, owner claim and readiness checks as every native deploy. */
export async function nativeMailgunDeploy(path,lifecycle,context){
 const {root,options,store,signal,setupManifest,setupSeed,operationToken,localOnlyKeys=[]}=context;
 const declaration=JSON.parse(await readFile(join(root,path),'utf8'));
 const input=await deployEnvironment({root,options,declaration,setupManifest,settings:lifecycle.settings,localOnlyKeys});
 validateRuntimeEnvironment(input.env);
 for(const name of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'])if(!input.env[name]?.trim())throw missing(`Native Mailgun deploy requires ${name}. Nothing was built or uploaded.`);
 committedSource(root,options);
 const ownerInput=await deployOwnerInput({root,adapter:context.adapter??lifecycle,setupSeed,options,signal});
 const addSecrets=values=>store.addSecrets?.(values);
 addSecrets((declaration.secrets??[]).map(item=>input.env[item.environment]).filter(Boolean));
 await withoutLocalSettings(root,{settings:lifecycle.settings,operationToken},()=>lifecycle.run(root,{},store,()=>{},signal,{verb:'build',operationToken}));
 await context.checkBuild?.();
 await refuseLocalEnvOutput(root);
 const environment=options.environment??'production';
 const command=(verb,extra=[],values=input.env,more={})=>owner([verb,'--declaration',path,'--environment',environment,...extra],values,{cwd:root,localOnlyKeys,...more});
 try{
  const deployed=await command('deploy',[],input.env,{notice:line=>store.report(line)});
  await keepSecrets({root,environment,kept:keptSecrets(declaration,setupManifest),env:input.env,generated:input.generated.filter(name=>deployed.sentSecrets.includes(name)),reused:input.reused.filter(name=>deployed.sentSecrets.includes(name)),report:(line,more)=>store.report(line,more)});
  await command('health',[],input.env,{propagation:deployed.propagation});
  const inspected=await command('inspect',[],input.env,{propagation:deployed.propagation});
  const linked=token=>context.linkDependencies?.(deployed.origin,token);
  const claimed=await claimHostedOwner({hook:lifecycle.hooks?.owner,setupManifest,declaration,deployed:{...deployed,propagation:deployed.propagation,...inspected},env:input.env,...ownerInput,supplied:input.supplied,addSecret:value=>addSecrets([value]),secret:(extra,values)=>command('secret',extra,values),beforeClaim:linked,recordClaim:outcome=>command('record-owner',['--outcome',outcome]),inspect:()=>command('inspect',[],input.env,{propagation:deployed.propagation}),store,signal});
  await checkHostedSetup({origin:deployed.origin,claimed:claimed??inspected.ownerClaim?.outcome,signal});
  store.report('deploy: native Mailgun installation published; hosted owner and readiness checked.');
  return {deployed:true,origin:deployed.origin,...(claimed?{owner:claimed}:{}),dependenciesLinked:true};
 }catch(error){
  const code=/^[a-z][a-z0-9-]{0,100}$/.test(error?.message??'')?error.message:'native-deploy-failed';
  throw missing(`Native Mailgun deployment stopped (${code}). Run the same deploy command again to continue the owned deployment. No secret values are shown.`);
 }
}
