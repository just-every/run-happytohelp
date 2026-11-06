import {readFile, writeFile} from 'node:fs/promises';
import {businessTeamRoleSchema} from "../../../../src/vendor/base/modules/business-settings/role-domain.mjs";

const file = new URL('./SETUP.schema.json', import.meta.url);
const source = await readFile(file, 'utf8');
const schema = JSON.parse(source);
if (process.argv.includes('--check')) {
  if (JSON.stringify(schema.$defs.businessTeamRole) !== JSON.stringify(businessTeamRoleSchema)) {
    throw Error('Business role schema is stale; run node schema/generate-business-role.mjs');
  }
} else {
  const definition = JSON.stringify(businessTeamRoleSchema, null, 2).replace(/\n/g, '\n    ');
  const result = source.replace(/("businessTeamRole": )\{[\s\S]*?\n    \}/, (_, name) => name + definition);
  if (result === source && JSON.stringify(schema.$defs.businessTeamRole) !== JSON.stringify(businessTeamRoleSchema)) {
    throw Error('Cannot locate Business role schema definition');
  }
  await writeFile(file, result);
}
