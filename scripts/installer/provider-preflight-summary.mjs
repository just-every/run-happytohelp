// Report only selected setting comparisons and binding names, never binding values.
// Run Edit Run fleet · 2026-11-17.
export function preflightSummary(declaration, subdomain, settings, secrets) {
 if (!subdomain || typeof subdomain.subdomain !== 'string' || !settings || Array.isArray(settings)
  || typeof settings !== 'object' || !Array.isArray(settings.bindings) || !Array.isArray(secrets)
  || secrets.some(row => !row || typeof row.name !== 'string' || row.type !== 'secret_text')) throw Error('shape');
 const lines = [], bindings = settings.bindings;
 let missing = false;
 const report = (name, present, detail = '') => {
  lines.push(`${name}: ${present ? 'present' : 'MISSING or mismatched'}${detail ? ` (${detail})` : ''}`);
  if (!present) missing = true;
 };
 lines.push(`Workers subdomain: ${subdomain.subdomain || 'MISSING'}`);
 if (!subdomain.subdomain) missing = true;
 report('Setting compatibility_date', settings.compatibility_date === declaration.compatibilityDate, `declared ${declaration.compatibilityDate}`);
 const flags = Array.isArray(settings.compatibility_flags) ? settings.compatibility_flags : [];
 for (const flag of declaration.compatibilityFlags ?? []) report(`Setting compatibility_flags / ${flag}`, flags.includes(flag));
 for (const [key, type] of [['d1', 'd1'], ['r2', 'r2_bucket'], ['kv', 'kv_namespace'], ['queues', 'queue'], ['durableObjects', 'durable_object_namespace'], ['services', 'service']])
  for (const row of declaration[key] ?? []) report(`Binding ${row.binding} / ${type}`, bindings.some(binding => binding?.name === row.binding && binding.type === type));
 const secretNames = new Set(secrets.map(row => row.name));
 const declaredSecrets = declaration.secrets ?? [];
 for (const name of new Set([...Object.keys(declaration.vars ?? {}), declaration.originVar, declaration.publicOriginSetting].filter(Boolean)))
  report(`Setting binding ${name}`, bindings.some(binding => binding?.name === name && ['plain_text', 'json', 'secret_text'].includes(binding.type)));
 for (const row of declaredSecrets) {
  const present = secretNames.has(row.binding);
  lines.push(`Secret NAME ${row.binding}: ${present ? 'present' : 'missing'} (${row.optional ? 'optional' : 'required by deploy.json'})`);
  if (!row.optional && !present) missing = true;
 }
 const extra = secrets.filter(row => !declaredSecrets.some(item => item.binding === row.name)).map(row => row.name).sort();
 // JSON-encode remote names/subdomain to keep control characters out of terminal output.
 lines[0] = `Workers subdomain: ${subdomain.subdomain ? JSON.stringify(subdomain.subdomain) : 'MISSING'}`;
 lines.push(`Other secret NAMES: ${extra.length ? extra.map(name => JSON.stringify(name)).join(', ') : 'none'}`);
 lines.push('Names do not prove secret validity. A spent H2H_SETUP_TOKEN may be absent after owner claim; compare this report with the installation lifecycle. Schedules, queue consumers, resource contents and health were not read.');
 return {lines, missing};
}
