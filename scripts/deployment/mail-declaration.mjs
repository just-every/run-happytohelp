// Native owner-account inputs and platform-assigned relay inputs have different
// names. Both declarations share resource identity and the same deployment kit.
export const managedDeployPath='management/integration/managed-deploy.json';
export const nativeSetupPath='management/integration/native-setup.json';
export function managedMailDeclaration(declaration){
 const managed=structuredClone(declaration);
 for(const secret of managed.secrets??[])if(['MAIL_PROVIDER','MAIL_FROM','MAIL_API_KEY'].includes(secret.binding))secret.environment=secret.binding;
 return managed;
}
export function nativeMailSetupManifest(manifest){
 const native=structuredClone(manifest);
 // Rer generates declared secrets even when their setup condition is inactive.
 // Native MAIL_API_KEY maps the owner's EMAIL_API_KEY and must never be generated.
 native.fields=native.fields.filter(field=>field.name!=='MAIL_API_KEY');
 return native;
}
