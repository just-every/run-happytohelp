import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {invalid,refuse} from '@runeditrun/rer/errors';
import {deployEnvironment} from '@runeditrun/rer/internal/cli/deploy-inputs.mjs';
import {requireProductionAuth} from '@runeditrun/rer/internal/cli/production-auth.mjs';
import {neededForRealDeploy} from '@runeditrun/rer/internal/cli/deploy-needs.mjs';
import {deployProductDirectory,deployProductArguments} from '@runeditrun/rer/internal/cli/deploy-product.mjs';
import {withoutLocalSettings,refuseLocalEnvOutput} from '@runeditrun/rer/internal/cli/local-env.mjs';
import {refuseLocalModels} from '@runeditrun/rer/internal/modules/deploy-kit/local-only.mjs';
import {packageBuild} from '@runeditrun/rer/internal/modules/deploy-kit/prepare.mjs';
import {ownerPlan,ownerWorkerName,localOnlyBinding} from '@runeditrun/rer/internal/modules/deploy-kit/owner.mjs';

/** Validate the actual declaration and packaged build without resolving a remote
 * target. Provider state and existing secret bindings deliberately remain unknown. */
export async function offlineDeploy(path,lifecycle,context){
 const {root,options,store,signal,operationToken,setupManifest,setupSeed,localOnlyKeys=[],checkBuild=async()=>{}}=context;
 if(options.remove||options.setSecret||options.unsetSecret||options.rotateSecret||options.reopenInstallationKey)
  throw invalid('Use deployment changes and --dry-run on separate runs.');
 await refuseLocalModels(root);
 const declaration=JSON.parse(await readFile(join(root,path),'utf8'));
 const local=localOnlyBinding(declaration,localOnlyKeys);
 if(local)throw refuse('Local development bindings cannot be deployed.');
 const {env}=await deployEnvironment({root,options,declaration,setupManifest,settings:lifecycle.settings,localOnlyKeys});
 const {signIn}=await requireProductionAuth({root,declaration,env,setupManifest,setupSeed,adapter:lifecycle,declarationPath:path,options})??{};
 const productDirectory=deployProductDirectory(declaration);
 await withoutLocalSettings(root,{settings:lifecycle.settings,operationToken},()=>lifecycle.run(root,{},store,()=>{},signal,{verb:'build',operationToken}));
 await checkBuild();
 await refuseLocalEnvOutput(root);
 await deployProductArguments(root,productDirectory);
 const artifact=await packageBuild({root,source:{sha:'0'.repeat(40),tree:'0'.repeat(40)},runIdentity:{id:'0',attempt:'1'},productDirectory:productDirectory??''});
 const environment=options.environment??'production',worker=ownerWorkerName(declaration.project,environment);
 // This reserved origin is used only for local shape validation, never reported
 // as a reachable deployment or used for a request.
 ownerPlan({project:declaration.project,environment,worker,origin:`https://${worker}.example.invalid`},declaration,artifact,{localOnlyKeys,env});
 const needed=neededForRealDeploy({declaration,env,signIn});
 store.report('deploy: offline dry run complete; no provider requests, mail or deployment. Target resources, credentials and existing secret bindings were not checked.');
 for(const item of needed)store.report(`deploy: needed for a real deploy: ${item}`);
 return {dryRun:true,deployed:false,providerChecked:false};
}
