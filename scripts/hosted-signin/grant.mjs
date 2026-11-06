import {createHash,randomBytes} from 'node:crypto';
import {loginDestination} from '../../src/platform/dashboard-path.js';

// The one-time sign-in grant: the same row an emailed sign-in link needs
// (src/modules/identity/magic-link.ts), written without sending anything.
// `db` is any D1-shaped handle: prepare(sql).bind(...).all()/first()/run().
export const grantSeconds=15*60;
export class SigninRefusal extends Error {}
const refuse=message=>new SigninRefusal(message);
const live="NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)";
const members=`SELECT m.project_id projectId,m.user_id userId,u.email email,m.role role FROM memberships m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE ${live}`;

/** The one existing owner or admin this selection names: `{project}` is that workspace's single owner, `{email}` a member's own address. */
export async function memberFor(db,{project,email}){
 if(Boolean(project)===Boolean(email))throw refuse('Name exactly one of --project (a workspace id) or --email (a member address).');
 if(project){
  const rows=(await db.prepare(`${members} AND m.project_id=? AND m.role='owner' ORDER BY m.user_id`).bind(project).all()).results;
  if(rows.length===1)return rows[0];
  const exists=await db.prepare(`SELECT p.id FROM projects p WHERE p.id=? AND ${live}`).bind(project).first();
  if(!exists)throw refuse(`No workspace ${project} exists in this installation.`);
  throw refuse(rows.length?`Workspace ${project} has ${rows.length} owners, so --project cannot choose one. Use --email with an owner's address.`:`Workspace ${project} has no owner.`);
 }
 const address=String(email).trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw refuse('--email must be a member email address.');
 const rows=(await db.prepare(`${members} AND lower(u.email)=? AND m.role IN ('owner','admin') ORDER BY m.project_id`).bind(address).all()).results;
 if(rows.length===1)return rows[0];
 if(!rows.length)throw refuse('That address is not an owner or admin of any existing workspace in this installation.');
 throw refuse(`That address is an owner or admin of ${rows.length} workspaces (${rows.map(row=>row.projectId).join(', ')}). Use --project to choose one.`);
}

const digest=token=>createHash('sha256').update(token).digest('hex');

/** Write one single-use grant for `member` and return the capability. Only its SHA-256 is stored. */
export async function issueGrant(db,member,{now=Date.now(),token=randomBytes(32).toString('hex')}={}){
 const expiresAt=now+grantSeconds*1000,hash=digest(token);
 // Admission is rechecked in the same statement: a role or workspace that changed since the lookup writes nothing.
 await db.prepare(`INSERT INTO magic_signins(token_hash,user_id,project_id,email,expires_at) SELECT ?,m.user_id,m.project_id,u.email,? FROM memberships m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=? AND m.role IN ('owner','admin') AND ${live}`).bind(hash,expiresAt,member.projectId,member.userId).run();
 const written=await db.prepare('SELECT email FROM magic_signins WHERE token_hash=? AND consumed_at IS NULL').bind(hash).first();
 if(!written)throw refuse('The member changed while the grant was written, so no sign-in link was issued. Run the command again.');
 return {token,email:written.email,expiresAt};
}

/** The link an emailed sign-in carries: the page /login/magic, with the token in the fragment. */
export function signInLink(origin,token){
 const url=new URL('/login/magic',origin);
 url.searchParams.set('returnTo',loginDestination(undefined,url.origin));
 url.hash=new URLSearchParams({token}).toString();
 return url.href;
}
