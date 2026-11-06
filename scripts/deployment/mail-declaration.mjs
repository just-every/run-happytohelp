// Native owner-account inputs and platform-assigned relay inputs have different
// names. Both declarations share resource identity and the same deployment kit.
export const managedDeployPath='management/integration/managed-deploy.json';
export const nativeSetupPath='management/integration/native-setup.json';
export const publicMailNames=['MAIL_PROVIDER','MAIL_FROM','MAIL_RELAY_URL','H2H_RER_MAIL_VERSION','RER_MAILBOX_ID','RER_MAIL_ADDRESS','RER_MAIL_CONTROL_URL'];
export function managedMailDeclaration(declaration){
 const managed=structuredClone(declaration);
 for(const secret of managed.secrets??[])if(secret.binding==='MAIL_API_KEY')secret.environment=secret.binding;
 return managed;
}
export function nativeMailSetupManifest(manifest){
 const native=structuredClone(manifest);
 // Rer generates declared secrets even when their setup condition is inactive.
 // Native MAIL_API_KEY maps the owner's EMAIL_API_KEY and must never be generated.
 native.fields=native.fields.filter(field=>field.name!=='MAIL_API_KEY');
 return native;
}
