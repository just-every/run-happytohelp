/** Workspace settings writes. Only a mode change through `PUT .../ai` writes the AI reply mode: every other
 * whole-object save keeps the stored row's `ai_reply_mode` and `ai_reply_mode_since` inside its own statement,
 * so a save whose read fell before a mode change can never restore the earlier mode. */
const MODE_KEYS="'$.ai_reply_mode','$.ai_reply_mode_since'"

/** Upserts a computed settings object without its two mode keys; the stored row's keys stay as they are
 * (`json_patch` drops a NULL member, so an absent key stays absent). */
export function settingsUpsert(db:D1Database,projectId:string,settings:Record<string,unknown>,updatedAt=Date.now()){
 return db.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_remove(?,${MODE_KEYS}),?)
  ON CONFLICT(project_id) DO UPDATE SET settings_json=json_patch(json_remove(excluded.settings_json,${MODE_KEYS}),
  json_object('ai_reply_mode',json_extract(project_settings.settings_json,'$.ai_reply_mode'),'ai_reply_mode_since',json_extract(project_settings.settings_json,'$.ai_reply_mode_since'))),
  updated_at=excluded.updated_at`).bind(projectId,JSON.stringify(settings),updatedAt)
}

/** Sets the two mode keys on the stored row; batched after `settingsUpsert` by a real mode change only. */
export function replyModeWrite(db:D1Database,projectId:string,mode:string,since:number){
 return db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.ai_reply_mode',?,'$.ai_reply_mode_since',?) WHERE project_id=?").bind(mode,since,projectId)
}
