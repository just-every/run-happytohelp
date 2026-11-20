import { readFileSync } from 'node:fs';
import { hash, physicalEntry, safe } from './files.mjs';

export const projectManifest = 'rer-project.json';

export function projectHashProblems(bytes, readBytes) {
 if (bytes === undefined) return [];
 let project;
 try { project = JSON.parse(bytes); }
 catch { return [`Correct the invalid JSON in ${projectManifest}.`]; }
 if (!project || typeof project !== 'object' || Array.isArray(project)) return [`Declare a JSON object in ${projectManifest}.`];

 const problems = [], hashes = new Map();
 const pending = [{ key: '', value: project }];
 for (const { key, value } of pending) {
  for (const [name, child] of Object.entries(value)) {
   if (!child || typeof child !== 'object') continue;
   const childKey = Array.isArray(value) ? `[${name}]`
    : /^[a-zA-Z_$][\w$]*$/.test(name) ? `${key ? '.' : ''}${name}` : `[${JSON.stringify(name)}]`;
   pending.push({ key: key + childKey, value: child });
  }
  if (!Object.hasOwn(value, 'path')) continue;
  for (const field of ['sha256', 'digest']) {
   if (!Object.hasOwn(value, field)) continue;
   const declaringKey = `${projectManifest} ${key ? key + '.' : ''}${field}`;
   const path = value.path, declared = value[field];
   let actual;
   try {
    safe(path);
    if (!hashes.has(path)) hashes.set(path, hash(readBytes(path)));
    actual = hashes.get(path);
   } catch {
    problems.push(`${declaringKey} names ${JSON.stringify(path)}. Correct the path or restore the named file as a readable regular file in the project tree.`);
    continue;
   }
   const digest = typeof declared === 'string' && (field === 'digest' ? declared.replace(/^sha256:/i, '') : declared);
   if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) {
    problems.push(`${declaringKey} for ${JSON.stringify(path)} must declare its SHA-256. File SHA-256 is ${actual}.`);
   } else if (digest.toLowerCase() !== actual) {
    problems.push(`${declaringKey} for ${JSON.stringify(path)} declares ${declared}. File SHA-256 is ${actual}. Update the declaration to match the file, or restore the file if you meant to roll it back.`);
   }
  }
 }
 return problems;
}

export function checkoutProjectHashProblems(root) {
 const readBytes = (path, optional = false) => {
  const entry = physicalEntry(root, path);
  if (entry.absent && optional) return undefined;
  if (!entry.target) throw Error('Expected a regular file in the checkout');
  return readFileSync(entry.target);
 };
 let bytes;
 try { bytes = readBytes(projectManifest, true); }
 catch { return [`Restore ${projectManifest} as a readable regular file in the project tree.`]; }
 return projectHashProblems(bytes, readBytes);
}
