-- Apply and undo now recheck only the rows a run matched, claimed or wrote, inside
-- their own batch. Retire the workspace-wide run counter and its columns.
DROP TRIGGER csv_run_contact_insert;
DROP TRIGGER csv_run_contact_update;
DROP TRIGGER csv_run_contact_delete;
DROP TRIGGER csv_run_company_insert;
DROP TRIGGER csv_run_company_update;
DROP TRIGGER csv_run_company_delete;
DROP TRIGGER csv_run_domain_insert;
DROP TRIGGER csv_run_domain_update;
DROP TRIGGER csv_run_domain_delete;
DROP TRIGGER csv_run_link_insert;
DROP TRIGGER csv_run_link_update;
DROP TRIGGER csv_run_link_delete;
DROP TRIGGER csv_run_definition_insert;
DROP TRIGGER csv_run_definition_update;
DROP TRIGGER csv_run_definition_delete;
DROP INDEX csv_customer_imports_active;
-- An unready run was never planned or shown; its rows were never written.
DELETE FROM csv_customer_imports WHERE ready=0;
ALTER TABLE csv_customer_imports DROP COLUMN ready;
ALTER TABLE csv_customer_imports DROP COLUMN revision;
ALTER TABLE csv_customer_imports DROP COLUMN epoch;
