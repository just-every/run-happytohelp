-- An inbound mail looks its sender's and each Cc's contact up by address with the expressions lower(email) and
-- lower(json_extract(metadata_json,'$.provided_email')) (src/modules/integrations/inbound-service.ts and
-- inbound-authority.ts: the blocked-sender check, the sender's contact and its insert guard, a reply's sender through a
-- reply address or from a preferred notification address). No index held either expression (api_contact_key_0 and _1
-- in 253 hold lower(trim(...)), which these lookups cannot use), so each lookup walked every contact of the workspace:
-- about 162,000 rows on a large imported workspace. These two indexes hold the lookups' expressions verbatim, so each
-- lookup searches its address and reads only the contacts holding it; the lookups' text and matches are unchanged.
-- Additive: no row changes.
CREATE INDEX contacts_address_lookup ON contacts(project_id,lower(email));
CREATE INDEX contacts_preferred_address_lookup ON contacts(project_id,lower(json_extract(metadata_json,'$.provided_email')));
