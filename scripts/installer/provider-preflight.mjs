#!/usr/bin/env node
// Run Edit Run fleet · 2026-11-17. Independent of rer deploy and its offline dry-run.
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {preflightSummary} from './provider-preflight-summary.mjs';

const usage = `Usage: pnpm run preflight:provider --account-id ACCOUNT_ID --worker WORKER --consent-read-only
Reads only this account's Workers subdomain and this Worker's settings and secret NAMES.
Requires CLOUDFLARE_API_TOKEN in the process environment (Account / Workers Scripts / Read).
No token file, deployment, mail, retries or redirects. See docs/INSTALLER.md#read-only-provider-preflight.`;
class Refusal extends Error {
 constructor(code, message) { super(message); this.code = code; }
}

async function get(path, label, token) {
 let response;
 try {
  response = await fetch('https://api.cloudflare.com/client/v4' + path, {
   method: 'GET', headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
   redirect: 'manual', signal: AbortSignal.timeout(15_000),
  });
 } catch {
  throw new Refusal(7, `Network failure reading ${label}; remote state is unknown. No retry was made.`);
 }
 // Never expose provider bodies, errors, headers or Location: any may echo credentials.
 if (response.status !== 200) {
  await response.body?.cancel().catch(() => {});
  if ([401, 403].includes(response.status)) throw new Refusal(5,
   `HTTP ${response.status} reading ${label}: authorization refused. Required permission: Account / Workers Scripts / Read on the named account. Check token validity and account scope; this response alone cannot distinguish them.`);
  if (response.status === 404) throw new Refusal(6,
   label === 'account Workers subdomain' ? 'HTTP 404: the account Workers subdomain was not found; no subdomain was created.' :
    'HTTP 404: the Worker was not found in the named account; no Worker was created.');
  if (response.status >= 300 && response.status < 400) throw new Refusal(8,
   `HTTP ${response.status} reading ${label}: redirect refused; no Location was followed.`);
  throw new Refusal(8, `HTTP ${response.status} reading ${label}; preflight incomplete. No retry was made.`);
 }
 let body;
 try { body = await response.json(); }
 catch { throw new Refusal(8, `Unreadable response for ${label}; preflight incomplete. No retry was made.`); }
 if (body?.success !== true || body.result === null || body.result === undefined)
  throw new Refusal(8, `Unsuccessful response for ${label}; preflight incomplete. No retry was made.`);
 return body.result;
}

async function main() {
 // The credential is read only from this environment variable. It is never persisted.
 const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
 const print = (stream, message) => stream.write((token ? message.replaceAll(token, '[REDACTED]') : message) + '\n');
 try {
  let options;
  try {
   options = parseArgs({strict: true, allowPositionals: false, options: {
    'account-id': {type: 'string'}, worker: {type: 'string'},
    'consent-read-only': {type: 'boolean'}, help: {type: 'boolean'},
   }}).values;
  } catch { throw new Refusal(2, usage); }
  if (options.help) { print(process.stdout, usage); return; }
  const account = options['account-id'], worker = options.worker;
  if (!/^[a-f0-9]{32}$/i.test(account ?? '') || !/^[a-z0-9_][a-z0-9_-]{0,62}$/i.test(worker ?? ''))
   throw new Refusal(2, 'Supply --account-id (32 hexadecimal characters) and --worker (the existing Worker name).\n' + usage);
  if (!options['consent-read-only']) throw new Refusal(3,
   `Consent required: account ${account}, Worker ${worker}. Review these targets, then explicitly add --consent-read-only to authorize only three GETs. No request was made.`);
  if (!token.trim()) throw new Refusal(4,
   'Missing scoped token: set CLOUDFLARE_API_TOKEN in the process environment. No credential file is read and no request was made.');
  if (account.includes(token) || worker.includes(token)) throw new Refusal(2,
   'Target identifiers must not contain CLOUDFLARE_API_TOKEN. Supply the account ID and Worker name, never the credential. No request was made.');
  let declaration;
  try { declaration = JSON.parse(await readFile(new URL('../../deploy.json', import.meta.url), 'utf8')); }
  catch { throw new Refusal(2, 'Could not read this edition’s deploy.json; no request was made.'); }
  print(process.stdout, `Read-only consent: account ${account}, Worker ${worker}. Reading only subdomain, settings and secret names.`);
  const base = `/accounts/${account}/workers`, script = `${base}/scripts/${worker}`;
  const subdomain = await get(`${base}/subdomain`, 'account Workers subdomain', token);
  const settings = await get(`${script}/settings`, 'Worker settings', token);
  const secrets = await get(`${script}/secrets`, 'Worker secret names', token);
  let summary;
  try { summary = preflightSummary(declaration, subdomain, settings, secrets); }
  catch { throw new Refusal(8, 'Unexpected provider response shape; preflight incomplete. No retry was made.'); }
  for (const line of summary.lines) print(process.stdout, line);
  if (summary.missing) throw new Refusal(9, 'Preflight found missing or mismatched declared settings or required secret names. No repairs were attempted.');
  print(process.stdout, 'Read-only preflight complete: exactly three GETs. Resource contents, secret values, edit permissions and remote provisioning were not qualified.');
 } catch (error) {
  print(process.stderr, error instanceof Refusal ? error.message : 'Preflight failed; remote state is unknown. No retry was made.');
  process.exitCode = error instanceof Refusal ? error.code : 8;
 } finally {
  print(process.stdout, 'No mail was sent and nothing was changed.');
 }
}
await main();
