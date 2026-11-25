export const RETENTION_LIMITS={min:90,max:3650}
export const DAY=86400000

export const retentionDays="CAST(json_extract(settings_json,'$.audit_retention_days') AS INTEGER)"
export const held=`EXISTS(SELECT 1 FROM audit_holds h WHERE h.project_id=audit_events.project_id AND h.released_at IS NULL AND audit_events.at>=h.starts_at AND (h.ends_at IS NULL OR audit_events.at<=h.ends_at))`
export const auditDueSql=(now:string,minimum=String(RETENTION_LIMITS.min))=>`FROM project_settings WHERE json_extract(settings_json,'$.audit_retention_days') IS NOT NULL AND ${retentionDays}>=${minimum} AND EXISTS(SELECT 1 FROM audit_events WHERE audit_events.project_id=project_settings.project_id AND at<${now}-${retentionDays}*${DAY} AND NOT ${held})`
