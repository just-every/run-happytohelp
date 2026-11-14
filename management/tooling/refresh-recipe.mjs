import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {happytohelpPlan} from './compile-plan.mjs';

/** Refresh the static integration from the native compiler and binding declarations. */
export async function refreshRecipe(root=fileURLToPath(new URL('../../',import.meta.url))){
const sourceRoot=pathToFileURL(resolve(root)+sep);
const {variableNames,secretNames}=await import(new URL('scripts/deployment/environment.mjs',sourceRoot));
const {repository}=JSON.parse(await readFile(new URL('package.json',sourceRoot),'utf8'));
const source=new URL(repository.url).pathname.slice(1);
const plan=await happytohelpPlan({root:sourceRoot,installationId:'recipe',environment:'production',variables:{H2H_PUBLIC_ORIGIN:'https://recipe.invalid',RER_MANAGEMENT_ORIGIN:'https://management.invalid',H2H_SETUP_OWNER_EMAIL:'owner@recipe.invalid'}});
const {workerName,publicVariables,secretNames:ignored,...recipe}=plan;
await writeFile(new URL('management/integration/recipe.json',sourceRoot),JSON.stringify({schema:1,source,variableNames,secretNames,plan:recipe},null,2)+'\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await refreshRecipe();
