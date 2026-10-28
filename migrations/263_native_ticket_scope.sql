-- Additive custody only. Native role-management does not yet expose narrowing.
-- NULL preserves every existing custom role's ticket visibility.
ALTER TABLE project_roles ADD COLUMN ticket_scope_json TEXT
 CHECK(ticket_scope_json IS NULL OR coalesce((json_valid(ticket_scope_json) AND json_type(ticket_scope_json)='object' AND json_type(ticket_scope_json,'$.groupIds')='array' AND json_type(ticket_scope_json,'$.includeUngrouped') IN ('true','false')),0));
