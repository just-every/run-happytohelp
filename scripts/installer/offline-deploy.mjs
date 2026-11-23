import {validateRuntimeEnvironment} from '../deployment/environment.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {invalid,refuse} from '@runeditrun/rer/errors';
import {deployEnvironment} from '@runeditrun/rer/internal/cli/deploy-inputs.mjs';
import {deployOwnerInput} from '@runeditrun/rer/internal/cli/deploy-owner-input.mjs';
import {requireProductionAuth} from '@runeditrun/rer/internal/cli/production-auth.mjs';
import {neededForRealDeploy} from '@runeditrun/rer/internal/cli/deploy-needs.mjs';
import {switchableDefaults} from '@runeditrun/rer/internal/cli/deploy-settings.mjs';
import {deployProductDirectory,deployProductArguments} from '@runeditrun/rer/internal/cli/deploy-product.mjs';
import {withoutLocalSettings,refuseLocalEnvOutput} from '@runeditrun/rer/internal/cli/local-env.mjs';
import {refuseLocalModels} from '@runeditrun/rer/internal/modules/deploy-kit/local-only.mjs';
import {packageBuild} from '@runeditrun/rer/internal/modules/deploy-kit/prepare.mjs';
import {ownerPlan,ownerWorkerName,localOnlyBinding} from '@runeditrun/rer/internal/modules/deploy-kit/owner.mjs';

/** Validate the actual declaration and packaged build without resolving a remote
 * target. Provider state and existing secret bindings deliberately remain unknown. */
export async function offlineDeploy(path,lifecycle,context,ownerNeed){
 const {root,options,store,signal,operationToken,setupManifest,setupSeed,localOnlyKeys=[],checkBuild=async()=>{}}=context;
 if(options.remove||options.setSecret||options.unsetSecret||options.rotateSecret||options.reopenInstallationKey)
  throw invalid('Use deployment changes and --dry-run on separate runs.');
 await refuseLocalModels(root);
 const declaration=JSON.parse(await readFile(join(root,path),'utf8'));
 const local=localOnlyBinding(declaration,localOnlyKeys);
 if(local)throw refuse('Local development bindings cannot be deployed.');
 const {env}=await deployEnvironment({root,options,declaration,setupManifest,settings:lifecycle.settings,localOnlyKeys});
 const nativeMailgun=env.EMAIL_PROVIDER==='mailgun'&&env.MAIL_PROVIDER==='mailgun';
 let signIn;
 if(nativeMailgun){
  try{validateRuntimeEnvironment(env);}catch(error){if(error?.constructor!==Error)throw error;signIn=error.message;}
 }else ({signIn}=await requireProductionAuth({root,declaration,env,setupManifest,setupSeed,adapter:lifecycle,declarationPath:path,options})??{});
 const {neededForRealDeploy:ownerNeeds}=await deployOwnerInput(context);
 const productDirectory=deployProductDirectory(declaration);
 await withoutLocalSettings(root,{settings:lifecycle.settings,operationToken},()=>lifecycle.run(root,{},store,()=>{},signal,{verb:'build',operationToken}));
 await checkBuild();
 await refuseLocalEnvOutput(root);
 await deployProductArguments(root,productDirectory);
 const artifact=await packageBuild({root,source:{sha:'0'.repeat(40),tree:'0'.repeat(40)},runIdentity:{id:'0',attempt:'1'},productDirectory:productDirectory??''});
 const environment=options.environment??'production',worker=ownerWorkerName(declaration.project,environment);
 // This reserved origin is used only for local shape validation, never reported
 // as a reachable deployment or used for a request.
 const publicDefaults=await switchableDefaults(declaration);
 const plan=ownerPlan({project:declaration.project,environment,worker,origin:`https://${worker}.example.invalid`},declaration,artifact,{localOnlyKeys,env,publicDefaults});
 const names=plan.secrets.filter(item=>!item.optional||typeof env[item.environment]==='string'&&env[item.environment].trim()).map(item=>item.binding).sort();
 store.report(`deploy: secret bindings (${names.length}): ${names.join(', ')||'none'}`,{names});
 const variables=Object.keys(plan.vars??{}).sort();
 store.report(`deploy: public bindings (${variables.length}): ${variables.join(', ')||'none'}`,{names:variables});
 const needs=[...neededForRealDeploy({declaration,env,signIn}),...(ownerNeeds??[])];
 if(signIn)needs.push('For sign-in without email, set MAIL_PROVIDER=none and use the one-time owner link instead of supplying sending-provider inputs. See OPERATIONS.md#sign-in-without-mail.');
 if(ownerNeed&&!needs.includes('OWNER_EMAIL'))needs.push(ownerNeed);
 return {dryRun:true,deployed:false,providerChecked:false,neededForRealDeploy:needs};
}
