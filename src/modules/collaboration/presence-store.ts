import type {Env} from '../../platform/env'
import {mayReplySql} from '../access/reply-sql'
import {ONLINE_CLOSE_GRACE_MS,ONLINE_TTL_MS} from './presence'

// A heartbeat rewrites the row only when it moves activity by a minute or more, revives an expired row, or keeps
// it from expiring (half its life has passed), so an open dashboard costs about one row write a minute.
const ACTIVE_STEP_MS=60_000

/** Records one teammate's workspace presence from their open streams, or that the last one closed (`null`): the row
 * then lingers for the close grace and expires. Only the workspace's project stream calls this. */
export async function recordOnline(env:Env,projectId:string,userId:string,state:{activeAt:number;seenAt:number}|null,now=Date.now()){
 if(!state){await env.DB.prepare('UPDATE operator_presence SET expires_at=MIN(expires_at,?) WHERE project_id=? AND user_id=?').bind(now+ONLINE_CLOSE_GRACE_MS,projectId,userId).run();return}
 await env.DB.prepare(`INSERT INTO operator_presence(project_id,user_id,active_at,expires_at) VALUES(?1,?2,?3,?4)
  ON CONFLICT(project_id,user_id) DO UPDATE SET active_at=excluded.active_at,expires_at=excluded.expires_at
  WHERE operator_presence.expires_at<=?5 OR abs(excluded.active_at-operator_presence.active_at)>=?6 OR excluded.expires_at-operator_presence.expires_at>=?7`)
  .bind(projectId,userId,state.activeAt,state.seenAt+ONLINE_TTL_MS,now,ACTIVE_STEP_MS,ONLINE_TTL_MS/2).run()
}

/** Teammates online in a workspace now: a current member whose role may reply, with a live dashboard stream and
 * activity within the workspace's idle timeout. Expired rows never count, whatever left them behind. */
export async function onlineTeammates(env:Env,projectId:string,idleMinutes:number,now=Date.now()){
 return (await env.DB.prepare(`SELECT u.id,u.name FROM operator_presence op JOIN memberships m ON m.project_id=op.project_id AND m.user_id=op.user_id JOIN users u ON u.id=op.user_id
  WHERE op.project_id=? AND op.expires_at>? AND op.active_at>? AND (m.role='owner' OR ${mayReplySql('m')}) ORDER BY u.name,u.id`).bind(projectId,now,now-idleMinutes*60_000).all<{id:string;name:string|null}>()).results
}
