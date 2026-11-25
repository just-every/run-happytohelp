/** Socket attachments survive Durable Object hibernation; the alarm expires them without storing draft text. */
export const PRESENCE_TTL_MS=30_000
export const PRESENCE_SWEEP_MS=5_000
export type PresenceState={expiresAt:number;typing:boolean;draft:boolean}
/** Workspace presence on an operator project stream: whose dashboard it is, when they last used it and when the
 * stream last reported. The dashboard reports every ONLINE_HEARTBEAT_MS; a stream silent for ONLINE_TTL_MS (a lost
 * connection, a restart) no longer counts, and a closed one lingers ONLINE_CLOSE_GRACE_MS so moving between pages
 * never reads as leaving. */
export const ONLINE_HEARTBEAT_MS=20_000,ONLINE_TTL_MS=90_000,ONLINE_CLOSE_GRACE_MS=10_000
/** A reported idle time is at most a day: older activity is simply idle. */
export const ONLINE_IDLE_REPORT_MAX_MS=86_400_000
export type OnlineState={userId:string;activeAt:number;seenAt:number}
export type SocketAttachment={conversationId?:string;projectId?:string;tokenHash:string;cursor:number;presence?:PresenceState;online?:OnlineState}
export type SocketActor={actor_id:string;role:string;name:string|null}
export type PresencePeer={id:string;name:string;typing:boolean;draft:boolean;expiresAt:number}
export function presenceFrame(conversationId:string,peers:PresencePeer[]){return {type:'presence',operatorOnly:true,conversationId,peers,expiresAt:Date.now()+PRESENCE_TTL_MS}}
/** Multiple browser tabs contribute one teammate, keeping the most active state. */
export function mergePresence(peers:PresencePeer[]){
 const merged=new Map<string,PresencePeer>()
 for(const peer of peers){const old=merged.get(peer.id);merged.set(peer.id,old?{...peer,typing:old.typing||peer.typing,draft:old.draft||peer.draft,expiresAt:Math.max(old.expiresAt,peer.expiresAt)}:peer)}
 return [...merged.values()].sort((a,b)=>a.id.localeCompare(b.id))
}
/** One teammate across their open dashboards, likewise: the latest activity and the latest report of a live stream. */
export function teammateOnline(states:OnlineState[],now:number){
 const live=states.filter(state=>state.seenAt+ONLINE_TTL_MS>now)
 return live.length?{activeAt:Math.max(...live.map(state=>state.activeAt)),seenAt:Math.max(...live.map(state=>state.seenAt))}:null
}
