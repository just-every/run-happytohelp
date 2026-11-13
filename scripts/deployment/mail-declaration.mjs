import {deploymentMailEnvironment,mailInputNames,outboundEmailOff} from './environment.mjs';
// Native owner-account inputs and platform-assigned relay inputs have different
// names. Both declarations share resource identity and the same deployment kit.
export const managedDeployPath='management/integration/managed-deploy.json';
export const nativeSetupPath='management/integration/native-setup.json';
export const publicMailNames=['MAIL_MODE','MAIL_PROVIDER','EMAIL_PROVIDER','EMAIL_API_KEY_NAME','MAILGUN_DOMAIN','MAILGUN_REGION','EMAIL_ACCOUNT_ID','MAIL_FROM','MAIL_RELAY_URL','H2H_RER_MAIL_VERSION','RER_MAILBOX_ID','RER_MAIL_ADDRESS','RER_MAIL_CONTROL_URL'];
/** Apply the selected state to the actual upload declaration, including aliases. */
export function selectedMailDeclaration(declaration,inputs){
 const env=deploymentMailEnvironment(inputs),off=outboundEmailOff(env);
 const ownNames=env.EMAIL_PROVIDER==='mailgun'?['EMAIL_FROM','MAILGUN_SENDING_KEY','MAILGUN_WEBHOOK_SIGNING_KEY']:['EMAIL_FROM','EMAIL_API_KEY',...(env.EMAIL_PROVIDER==='cloudflare'?['EMAIL_ACCOUNT_ID']:[])];
 const providerInputs=mailInputNames.filter(name=>!name.startsWith('GOOGLE_MAIL_')&&!name.startsWith('MICROSOFT_MAIL_')&&!name.startsWith('MAILBOX_'));
 const selected=env.MAIL_PROVIDER==='rer'?managedMailDeclaration(declaration):structuredClone(declaration);
 selected.vars={...selected.vars,...Object.fromEntries(publicMailNames.filter(name=>typeof env[name]==='string'&&env[name]).map(name=>[name,env[name]]))};
 selected.secrets=(selected.secrets??[]).filter(item=>!Object.hasOwn(selected.vars,item.binding)&&!(off&&(mailInputNames.includes(item.binding)||mailInputNames.includes(item.environment)))&&!(env.MAIL_PROVIDER!=='rer'&&(providerInputs.includes(item.binding)||providerInputs.includes(item.environment))&&!ownNames.includes(item.environment)));
 if(off)for(const name of mailInputNames)delete selected.vars[name];
 return selected;
}
export function managedMailDeclaration(declaration){
 const managed=structuredClone(declaration);
 for(const secret of managed.secrets??[])if(secret.binding==='MAIL_API_KEY')secret.environment=secret.binding;
 return managed;
}
export function nativeMailSetupManifest(manifest){
 const native=structuredClone(manifest);
 // This manifest serves every deploy whose mail mode is not `rer`, so its
 // managed-mail fields are never active. Rer generates declared secrets even when
 // their setup condition is inactive: drop those keys so a native or mail-off
 // deploy binds no managed mail authority. Native MAIL_API_KEY maps the owner's
 // EMAIL_API_KEY and must never be generated.
 native.fields=native.fields.filter(field=>!(field.generate&&field.when?.field==='MAIL_MODE'&&field.when.equals==='rer'));
 return native;
}
