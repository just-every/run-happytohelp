-- Keep each widget survey's scale, locale and timing with its exact resolution.
-- Old cycles retain the original immediate thumbs behavior. Settings changes do
-- not reinterpret old feedback; widget opt-out is a visitor-owned preference.
CREATE TRIGGER csat_widget_cycle AFTER INSERT ON conversation_resolutions BEGIN
 UPDATE conversation_resolutions SET evidence_json=json_set(evidence_json,'$.widgetSurvey',json_object(
 'enabled',COALESCE((SELECT json_extract(settings_json,'$.csat_widget_enabled') FROM project_settings WHERE project_id=NEW.project_id),1),
 'scale',COALESCE((SELECT scale FROM csat_settings WHERE project_id=NEW.project_id),'thumbs'),
 'locale',COALESCE((SELECT locale FROM csat_settings WHERE project_id=NEW.project_id),'en'),
 'availableAt',NEW.resolved_at+COALESCE((SELECT delay_minutes FROM csat_settings WHERE project_id=NEW.project_id),0)*60000,
 'expiresAt',NEW.resolved_at+(COALESCE((SELECT delay_minutes FROM csat_settings WHERE project_id=NEW.project_id),0)*60000)+(COALESCE((SELECT expires_days FROM csat_settings WHERE project_id=NEW.project_id),14)*86400000)
 )) WHERE id=NEW.id;
END;
