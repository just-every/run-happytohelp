# Deployment source receipt

Inspected the checkout adapter and installed pinned rer 0.2.112. The public command output is saved in dry-run.log.

## scripts/installer/hosted-deploy.mjs
SHA-256: 1a2ffd35a9e8754be4cc9d898118f32242faea188bb347456a509f2dec03688d

Lines 36-60:
```javascript
   // MAIL_PROVIDER=none is the deploy's explicit choice to bind nothing that can send.
   // Owners then sign in with scripts/hosted-signin.mjs, declared as mailOffSignIn.
   const off=outboundEmailOff(env);
   // Native credentials must be real inputs, never the managed key generator's
   // output. Managed generated keys are resolved later by ownerDeploy. A dry run
   // goes ahead without them and lists what a real deploy needs.
   if(env.MAIL_PROVIDER!=='rer'&&!context.options.dryRun)refusal(()=>validateRuntimeEnvironment(inputs));
   const email=String(env.OWNER_EMAIL||'').trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/@(?:[^@]+\.)?(?:test|invalid|localhost|example)$/i.test(email)||/@(?:example\.(?:com|net|org))$/i.test(email))
    throw missing(`Deploy needs a real OWNER_EMAIL${off?', the owner this installation is claimed for':' that can receive sign-in mail'}. The local trial owner (owner@run-happytohelp.test) has no mailbox and cannot own a hosted workspace. Set OWNER_EMAIL privately in your environment or an owned 0600 --env-file, then run the same deploy command again. Nothing was deployed.`);
   if(env.MAIL_PROVIDER!=='rer'&&!off&&!context.options.dryRun&&!env.EMAIL_PROVIDER?.trim())throw missing('Production sign-in needs native outbound email: EMAIL_PROVIDER (resend, sendgrid, cloudflare or mailgun), EMAIL_FROM, EMAIL_API_KEY. Cloudflare also requires EMAIL_ACCOUNT_ID. Set these privately in your environment or an owned 0600 --env-file, then run the same deploy command again. Nothing was built or uploaded.');
   // Rer already validated and imported the private file. Consume those resolved
   // inputs once so rereading it cannot put the setup discriminator `direct`
   // back over the actual provider during preflight or the final report.
   Object.assign(process.env,env);
   for(const name of Object.keys(inputs))if(!(name in env))delete process.env[name];
   if(env.MAIL_PROVIDER===undefined)delete process.env.MAIL_PROVIDER;
   context.options.envFile=undefined;
   // Keep the explicit off switch in the upload; saving credentials alone cannot enable mail.
   const custom=await hostedDeclaration(context.root,declaration,env.H2H_PUBLIC_ORIGIN,env);
   if(context.options.dryRun)return offlineDeploy(custom||path,lifecycle,context);
   await transitionMailBindings(context,declaration,env);
   if(env.EMAIL_PROVIDER==='mailgun'&&!off&&env.MAIL_PROVIDER!=='rer')return nativeMailgunDeploy(custom||path,lifecycle,context);
   if(custom)return ownerDeploy(custom,lifecycle)(context);
  }
```

## scripts/installer/offline-deploy.mjs
SHA-256: 15f94a57961ed2bf0af6e4f4630bf79b2d8e05df048ff6585aa045622277fe05

Lines 14-48:
```javascript
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
 const nativeMailgun=env.EMAIL_PROVIDER==='mailgun'&&env.MAIL_PROVIDER==='mailgun';
 let signIn;
 if(nativeMailgun){
  try{validateRuntimeEnvironment(env);}catch(error){if(error?.constructor!==Error)throw error;signIn=error.message;}
 }else ({signIn}=await requireProductionAuth({root,declaration,env,setupManifest,setupSeed,adapter:lifecycle,declarationPath:path,options})??{});
 const productDirectory=deployProductDirectory(declaration);
 await withoutLocalSettings(root,{settings:lifecycle.settings,operationToken},()=>lifecycle.run(root,{},store,()=>{},signal,{verb:'build',operationToken}));
 await checkBuild();
 await refuseLocalEnvOutput(root);
 await deployProductArguments(root,productDirectory);
 const artifact=await packageBuild({root,source:{sha:'0'.repeat(40),tree:'0'.repeat(40)},runIdentity:{id:'0',attempt:'1'},productDirectory:productDirectory??''});
 const environment=options.environment??'production',worker=ownerWorkerName(declaration.project,environment);
 // This reserved origin is used only for local shape validation, never reported
 // as a reachable deployment or used for a request.
 const plan=ownerPlan({project:declaration.project,environment,worker,origin:`https://${worker}.example.invalid`},declaration,artifact,{localOnlyKeys,env});
 const names=plan.secrets.filter(item=>!item.optional||typeof env[item.environment]==='string'&&env[item.environment].trim()).map(item=>item.binding).sort();
 store.report(`deploy: secret bindings (${names.length}): ${names.join(', ')||'none'}`,{names});
 const variables=Object.keys(plan.vars??{}).sort();
 store.report(`deploy: public bindings (${variables.length}): ${variables.join(', ')||'none'}`,{names:variables});
 const needed=neededForRealDeploy({declaration,env,signIn});
 store.report('deploy: offline dry run complete; no provider requests, mail or deployment. Target resources, credentials and existing secret bindings were not checked.');
 for(const item of needed)store.report(`deploy: needed for a real deploy: ${item}`,{names:item.match(/\b[A-Z][A-Z0-9_]+\b/g)??[]});
 return {dryRun:true,deployed:false,providerChecked:false};
}
```

## node_modules/@runeditrun/rer/cli/deploy-command.mjs
SHA-256: 793eb5906fe3041e2fa97377e77e14e90f952711feff60419da6b1252baad168

Lines 84-98:
```javascript
 await enforceDeployPolicy({ ...context, declaration, declarationPath: path, settings });
 // Required secrets have been checked; retain the production sign-in guidance.
 const dryRun = async (result, { planned = true, extraNeeded } = {}) => {
  const production = await deployEnvironment({ root, options, declaration, setupManifest, settings, localOnlyKeys });
  const plan = result?.plan ?? (!planned ? undefined : (await owner(['local-plan', '--declaration', path, '--environment', options.environment ?? 'production', ...await deployProductArguments(root, deployProductDirectory(declaration))], production.env, { cwd: root, localOnlyKeys })).plan);
  result = { ...result, dryRun: true, deployed: false, providerChecked: false, plan };
  const { signIn, mailOff } = await requireProductionAuth({ root, declaration, env: production.env, setupManifest, setupSeed: context.setupSeed, adapter, declarationPath: path, options }) ?? {};
  if (mailOff) store.report(mailOffNotice(mailOff, options.environment ?? 'production'), { names: mailOff.credentialNames });
  // The one completion line: rer's own plan step (or its deliberate skip) succeeded. A hook's own line says only that the hook finished.
  store.report('deploy: local dry run complete; no credentials were needed, no Cloudflare requests were made and nothing was changed remotely. Target secrets and remote readiness were not checked.');
  const needed = [...new Set([...neededForRealDeploy({ declaration, env: production.env, signIn, secretsChecked: false }), ...(result.neededForRealDeploy ?? []), ...(extraNeeded ?? [])])];
  reportNeeded(store, needed);
  if (declaration.secrets?.some(item => item.binding === 'INSTALLATION_KEY')) store.report('deploy: INSTALLATION_KEY is a private generated binding; INSTALLATION_KEY_PREVIOUS is optional and managed only during rotation or an explicit retired-key reopen. Values are withheld.');
  return needed.length && result && typeof result === 'object' ? { ...result, neededForRealDeploy: needed } : result;
 };
```
