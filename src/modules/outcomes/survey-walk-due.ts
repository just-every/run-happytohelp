// Follow the same enabled window and durable cursor as the bounded survey walk.
export const surveyWalkStartSql=(now:string)=>`SELECT max(min(cfg.enabled_at),${now}-max(cfg.delay_minutes*60000+cfg.expires_days*86400000)) earliest,min(cfg.delay_minutes) delay_minutes,k.resolved_at,k.resolution_id FROM csat_settings cfg LEFT JOIN csat_discovery_cursor k ON k.id=1 WHERE cfg.enabled=1`
export const surveyWalkDueSql=(now:string)=>`SELECT 1 FROM (${surveyWalkStartSql(now)}) start
 WHERE start.earliest IS NOT NULL AND EXISTS (
  SELECT 1 FROM conversation_resolutions INDEXED BY conversation_resolutions_survey_walk
  WHERE reopened_at IS NULL AND (resolved_at,id)>(
   CASE WHEN start.resolved_at>=start.earliest THEN start.resolved_at ELSE start.earliest-1 END,
   CASE WHEN start.resolved_at>=start.earliest THEN start.resolution_id ELSE '' END
  )
 )`
