/** Socket attachments survive Durable Object hibernation; the alarm expires them without storing draft text. */
export const PRESENCE_TTL_MS=30_000
export const PRESENCE_SWEEP_MS=5_000
export type PresenceState={expiresAt:number;typing:boolean;draft:boolean}
export type SocketAttachment={conversationId?:string;projectId?:string;tokenHash:string;cursor:number;presence?:PresenceState}
export type SocketActor={actor_id:string;role:string;name:string|null}
export type PresencePeer={id:string;name:string;typing:boolean;draft:boolean;expiresAt:number}
export function presenceFrame(conversationId:string,peers:PresencePeer[]){return {type:'presence',operatorOnly:true,conversationId,peers,expiresAt:Date.now()+PRESENCE_TTL_MS}}
/** Multiple browser tabs contribute one teammate, keeping the most active state. */
export function mergePresence(peers:PresencePeer[]){
 const merged=new Map<string,PresencePeer>()
 for(const peer of peers){const old=merged.get(peer.id);merged.set(peer.id,old?{...peer,typing:old.typing||peer.typing,draft:old.draft||peer.draft,expiresAt:Math.max(old.expiresAt,peer.expiresAt)}:peer)}
 return [...merged.values()].sort((a,b)=>a.id.localeCompare(b.id))
}
