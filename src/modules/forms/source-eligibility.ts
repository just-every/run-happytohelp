// Resolve the applied source, not another upload with the same field ID. This
// also covers existing imports without rewriting staff definitions or values.
// If source custody was erased, an imported field needs proof of visibility
// before its definition can cross the customer-form boundary.
export const sourceAllowsForms=`NOT EXISTS(
 SELECT 1 FROM move_in_origins origin
 WHERE origin.project_id=f.project_id AND origin.target_kind='field'
 AND origin.target_id=f.id AND origin.vendor='zendesk'
 AND NOT EXISTS(
  SELECT 1 FROM ik_provenance provenance
  JOIN move_in_batches batch ON batch.kit_job_id=provenance.job_id
  JOIN move_in_records record ON record.run_id=batch.run_id
  WHERE provenance.destination=f.project_id AND provenance.target_kind='field'
  AND provenance.target_id=f.id AND provenance.reversed=0
  AND json_extract(record.record_json,'$.namespace')='zendesk'
  AND json_extract(record.record_json,'$.kind')='ticket_field'
  AND json_extract(record.record_json,'$.sourceId')=json_extract(provenance.record_json,'$.sourceId')
  AND json_extract(record.record_json,'$.payloadHash')=json_extract(provenance.record_json,'$.sourceHash')
  AND json_type(record.record_json,'$.payload.visible_in_portal')='true'
 ))`
