import type {Env} from '../../platform/env'
import type {Run} from './types'
import {apiRun} from './api-store'
import {guarded} from './context'
export async function apiCheckpoint(env:Env,run:Run){
 const api=await apiRun(env,run.id);if(!api)return
 const current=await env.DB.prepare('SELECT state FROM move_in_runs WHERE id=?').bind(run.id).first<{state:string}>()
 if(current?.state==='completed')await guarded(env,run,[env.DB.prepare('UPDATE move_in_connections SET watermark=max(coalesce(watermark,0),?) WHERE id=?').bind(api.watermark,api.connection_id)])
 if(current?.state==='undone')await guarded(env,run,[env.DB.prepare("UPDATE move_in_connections SET watermark=(SELECT max(a.watermark) FROM move_in_api_runs a JOIN move_in_runs r ON r.id=a.run_id WHERE a.connection_id=move_in_connections.id AND r.state='completed') WHERE id=?").bind(api.connection_id)])
}
