// The contacts' live tally (migration 317) is rebuilt from the restored rows after every import: an archive from
// before 317, or one whose rows were restored with triggers suspended, carries none or a stale one.
export const contactTallyRebuildSql="DELETE FROM contact_tallies; INSERT INTO contact_tallies(project_id,total) SELECT project_id,count(*) FROM contacts WHERE coalesce(json_extract(metadata_json,'$.is_deleted'),0)!=1 GROUP BY project_id;";
