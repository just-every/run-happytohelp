import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {usableContact,xml,type VoiceNumber} from './model'

export const mediaAllowed=(alias='v')=>`${alias}.consent='granted' AND ${alias}.media_withdrawn_at IS NULL AND ${alias}.media_expires_at>?`
export function liveTranscription(url:string){
 return `<Start><Transcription name="support-transcript" track="both_tracks" inboundTrackLabel="caller" outboundTrackLabel="teammate" partialResults="false" statusCallbackUrl="${xml(url)}"/></Start>`
}
/** Final provider utterances only. Sequence ordering is stable across redelivery.
 * Extractive summaries quote retained speech; no external model gets call content. */
export async function acceptTranscript(env:Env,n:VoiceNumber,call:any,b:any,live=false){
 if(live&&b.TranscriptionEvent!=='transcription-content')return
 if(live&&b.Final!=='true')return
 let text=b.TranscriptionText,sequence=0,track='voicemail'
 if(live){
  let data;try{data=JSON.parse(b.TranscriptionData)}catch{throw new HTTPException(400)}
  text=data.transcript;sequence=Number(b.SequenceId);track=b.Track
  if(!/^\d+$/.test(b.SequenceId)||!Number.isSafeInteger(sequence)||sequence<0||sequence>1000000||!['inbound_track','outbound_track'].includes(track))throw new HTTPException(400)
 }
 if(typeof text!=='string'||!text.trim()||text.length>16000)throw new HTTPException(400)
 const digest=await hashToken(JSON.stringify([track,text])),now=Date.now()
 const alive=`EXISTS(SELECT 1 FROM voice_calls v JOIN conversations c ON c.id=v.conversation_id AND c.project_id=v.project_id WHERE v.id=? AND v.erased=0 AND ${mediaAllowed()} AND ${usableContact}) AND EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND enabled=1 AND version=?)`,args=[call.id,now,n.id,n.version]
 const prior=await env.DB.prepare('SELECT digest FROM voice_transcript_segments WHERE call_id=? AND sequence=?').bind(call.id,sequence).first<{digest:string}>()
 if(prior&&prior.digest!==digest)throw new HTTPException(409,{message:'Transcription sequence already has different content'})
 await env.DB.batch([
 env.DB.prepare(`INSERT OR IGNORE INTO voice_transcript_segments(call_id,sequence,track,content,digest) SELECT ?,?,?,?,? WHERE ${alive} AND (SELECT count(*) FROM voice_transcript_segments WHERE call_id=?)<400 AND (SELECT coalesce(sum(length(content)),0) FROM voice_transcript_segments WHERE call_id=?)+length(?)<=16000`).bind(call.id,sequence,track,text,digest,...args,call.id,call.id,text),
 env.DB.prepare(`UPDATE voice_calls SET transcript=(SELECT group_concat(line,char(10)) FROM (SELECT CASE track WHEN 'inbound_track' THEN 'Caller: ' WHEN 'outbound_track' THEN 'Teammate: ' ELSE '' END||content line FROM voice_transcript_segments WHERE call_id=? ORDER BY sequence)),updated_at=? WHERE id=? AND ${alive}`).bind(call.id,now,call.id,...args),
 env.DB.prepare(`UPDATE voice_calls SET summary='Transcript highlights (verbatim): '||substr(transcript,1,600) WHERE id=? AND transcript IS NOT NULL AND ${alive}`).bind(call.id,...args),
 ])
 const saved=await env.DB.prepare('SELECT digest FROM voice_transcript_segments WHERE call_id=? AND sequence=?').bind(call.id,sequence).first<{digest:string}>()
 if(!saved)throw new HTTPException(409,{message:'Media is unavailable or the transcript limit was reached'})
 if(saved.digest!==digest)throw new HTTPException(409)
}
/** Bounded hourly cleanup. Reads and webhook writes enforce expiry immediately. */
export async function expireVoiceMedia(env:Env){
 const now=Date.now(),ids=`SELECT id FROM voice_calls WHERE media_expires_at<=? AND (recording_cipher IS NOT NULL OR transcript IS NOT NULL OR summary LIKE 'Transcript highlights%') LIMIT 100`
 await env.DB.batch([
 env.DB.prepare(`DELETE FROM voice_transcript_segments WHERE call_id IN (${ids})`).bind(now),
 env.DB.prepare(`UPDATE voice_calls SET recording_cipher=NULL,transcript=NULL,summary='',updated_at=? WHERE id IN (${ids})`).bind(now,now),
 ])
}
