// Adapted from Base 0.2.90 export/verify-plan.mjs (ab97e5e864013ef03fd7f1e1a335101dd9150891).
// Seed proof names include the shared build and retained installer/legacy jobs.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { githubEvidence } from './verify-evidence.mjs';
import { lightReaders } from './verify-light.mjs';
import { pushProof } from './verify-inventory.mjs';

const shaShape = value => /^[a-f0-9]{40}$/.test(value ?? '');
const commitShape = value => shaShape(value?.sha) && shaShape(value?.commit?.tree?.sha) && Array.isArray(value.parents)
 && value.parents.every(parent => shaShape(parent.sha));
const full = reason => ({ coverage: 'full', skip: false, reason, readers: [] });

// Run metadata alone cannot distinguish a branch and a tag. The successful
// full-push-proof is emitted only for branch refs, after all push shards.
const pushCandidate = run => run.event === 'push' && Boolean(run.head_branch);
export async function planVerification({ env = process.env, fetch = globalThis.fetch, cwd = process.cwd(), plan,
 readers = lightReaders } = {}) {
 const isTag = Boolean(env.GITHUB_REF?.startsWith('refs/tags/'));
 const tier = isTag ? 'all' : env.TIER || 'push';
 if (!['push', 'all'].includes(tier)) throw Error('Unknown verification tier');
 const result = full('No qualifying push evidence');
 const finish = decision => ({ ...decision, tier, matrix: { include: (decision.skip || decision.coverage === 'light' ? []
  : decision.coverage === 'slow' ? plan.slow : tier === 'all' ? [...plan.push, ...plan.slow] : plan.push).map(({ name, browser }) => ({ name, browser })) } });
 try {
  const api = githubEvidence(env, fetch), current = await api.run(env.GITHUB_RUN_ID);
  if (current.head_sha !== env.GITHUB_SHA || current.name !== env.GITHUB_WORKFLOW
   || current.repository.full_name !== env.GITHUB_REPOSITORY || current.event !== env.GITHUB_EVENT_NAME) return finish(result);
  // A release tag names a commit that a branch push already verified in full: reuse that proof, and run only
  // the slow tier (installer journeys, legacy export, every-release upgrades) once per release.
  if (isTag) {
   if (await api.proven(current, env.GITHUB_SHA, pushCandidate, pushProof) && await api.pushesClear(current, env.GITHUB_SHA)) {
    return finish({ coverage: 'slow', skip: false, readers: [], reason: 'Release tag on a commit with full push proof' });
   }
   return finish(full('Release tag has no full push proof on its commit'));
  }
  if (tier !== 'push' || env.GITHUB_EVENT_NAME !== 'push') return finish(result);
  const head = env.GITHUB_SHA, headBranch = current.head_branch;
  if (!env.GITHUB_REF?.startsWith('refs/heads/') || !api.sameRepository(current, current)
   || current.head_branch !== env.GITHUB_REF.slice('refs/heads/'.length)) return finish(result);
  const exact = await api.newest(current, head, run => pushCandidate(run) && run.head_branch !== headBranch);
  if (exact) {
   if (await api.proof(exact, pushProof)) {
    return finish({ ...result, coverage: 'reuse', skip: true, reason: 'Full push proof on another branch' });
   }
   return finish(full('Newest eligible push has no full proof'));
  }
  // Retain the seed's C3 rule: failed or unfinished evidence on this SHA
  // cannot be hidden by successful direct-parent verification.
  if (!await api.pushesClear(current, head)) return finish(full('Current SHA has conflicting push evidence'));
  const commit = await api.get(`commits/${head}`);
  if (!commitShape(commit) || commit.sha !== head || commit.parents.length !== 1) return finish(full('Ambiguous direct parent'));
  const parent = await api.get(`commits/${commit.parents[0].sha}`);
  if (!commitShape(parent) || parent.sha !== commit.parents[0].sha) return finish(result);
  const evidence = await api.newest(current, parent.sha, pushCandidate);
  if (!await api.proof(evidence, pushProof)) return finish(full('Direct parent is not push verified'));
  if (commit.commit.tree.sha === parent.commit.tree.sha) return finish({ ...result, coverage: 'reuse', skip: true, reason: 'Direct push-verified parent has the same tree' });
  // Local Git gives the complete diff with both rename sides, without the REST
  // compare endpoint's truncated file list. Checkout fetches the parent too.
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (git('rev-parse', 'HEAD').trim() !== head || git('rev-parse', `${head}^{tree}`).trim() !== commit.commit.tree.sha
   || git('rev-parse', `${parent.sha}^{tree}`).trim() !== parent.commit.tree.sha) return finish(full('Local comparison identity is uncertain'));
  const records = git('diff', '--name-status', '-z', '--find-renames', parent.sha, head, '--').split('\0');
  records.pop();
  const files = [];
  while (records.length) {
   const status = records.shift();
   if (!/^(?:[AMD]|R\d+)$/.test(status)) return finish(full('Uncertain changed paths'));
   const paths = records.splice(0, status.startsWith('R') ? 2 : 1);
   if (paths.length !== (status.startsWith('R') ? 2 : 1) || paths.some(path => !path)) return finish(result);
   files.push(...paths);
  }
  const dependencies = await readers(files, { cwd, plan });
  if (!dependencies) return finish(full('Code change or unknown reader dependencies'));
  return finish({ coverage: 'light', skip: false, readers: dependencies, reason: 'Allowed complete diff on a push-verified parent' });
 } catch {
  return finish(full('Evidence lookup or comparison unavailable'));
 }
}
