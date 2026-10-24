// Native owner-account inputs and platform-assigned relay inputs have different
// names. Both declarations share resource identity and the same deployment kit.
export const managedDeployPath='management/integration/managed-deploy.json';
export function managedMailDeclaration(declaration){
 const managed=structuredClone(declaration);
 for(const secret of managed.secrets??[])if(['MAIL_PROVIDER','MAIL_FROM','MAIL_API_KEY'].includes(secret.binding))secret.environment=secret.binding;
 return managed;
}
