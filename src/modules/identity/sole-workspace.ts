/**
 * A workspace owner replaces a teammate's account-wide sign-in (password, second factors and
 * recovery codes) only while that workspace holds the account's sole membership and the account
 * does not administer the installation, the same rule member erasure applies. An account that
 * also belongs to another workspace changes its own sign-in.
 * `user` and `project` are SQL expressions: numbered parameters (?1) or column references.
 */
export const soleWorkspaceAccount=(user:string,project:string)=>`EXISTS(SELECT 1 FROM memberships WHERE user_id=${user} AND project_id=${project}) AND NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=${user} AND project_id<>${project}) AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE user_id=${user})`
export const sharedAccountMessage='This teammate’s account also belongs to another workspace or administers this installation, so only they can change how it signs in.'
export const soleWorkspace=async(db:D1Database,userId:string,projectId:string)=>Boolean(await db.prepare(`SELECT 1 WHERE ${soleWorkspaceAccount('?1','?2')}`).bind(userId,projectId).first())
