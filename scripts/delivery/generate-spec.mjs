import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {managedMailDeclaration,managedDeployPath,nativeMailSetupManifest,nativeSetupPath} from '../deployment/mail-declaration.mjs';
import {deploymentSpec} from './base/spec.mjs';

/** Keep the importable contract identical to the delivery artifact's generated spec. */
export async function generateDeploymentSpec(root=process.cwd()) {
 const config=JSON.parse(await readFile(resolve(root,'scripts/delivery/base/packaging.json'),'utf8'));
 const spec=await deploymentSpec(root,config.artifact.specInputs);
 const output=resolve(root,'management/integration/deployment-spec.json');
 await writeFile(output,JSON.stringify(spec,null,2)+'\n');
 const declaration=JSON.parse(await readFile(resolve(root,'deploy.json'),'utf8'));
 await writeFile(resolve(root,managedDeployPath),JSON.stringify(managedMailDeclaration(declaration),null,2)+'\n');
 const setupManifest=JSON.parse(await readFile(resolve(root,'rer-setup.json'),'utf8'));
 await writeFile(resolve(root,nativeSetupPath),JSON.stringify(nativeMailSetupManifest(setupManifest),null,2)+'\n');
 return output;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 console.log(await generateDeploymentSpec());
