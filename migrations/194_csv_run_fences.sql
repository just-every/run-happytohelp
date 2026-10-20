-- Concurrency belongs to an import run, not unrelated native customer writes.
-- Preserve already-previewed runs while replacing the global counter.
ALTER TABLE csv_customer_imports ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE csv_customer_imports ADD COLUMN ready INTEGER NOT NULL DEFAULT 1 CHECK(ready IN (0,1));
UPDATE csv_customer_imports SET revision=coalesce((SELECT revision FROM csv_customer_epochs WHERE project_id=csv_customer_imports.project_id),0);
CREATE INDEX csv_customer_imports_active ON csv_customer_imports(project_id,status);
DROP TRIGGER csv_epoch_contact_insert;
DROP TRIGGER csv_epoch_contact_update;
DROP TRIGGER csv_epoch_contact_delete;
DROP TRIGGER csv_epoch_company_insert;
DROP TRIGGER csv_epoch_company_update;
DROP TRIGGER csv_epoch_company_delete;
DROP TRIGGER csv_epoch_domain_insert;
DROP TRIGGER csv_epoch_domain_update;
DROP TRIGGER csv_epoch_domain_delete;
DROP TRIGGER csv_epoch_link_insert;
DROP TRIGGER csv_epoch_link_update;
DROP TRIGGER csv_epoch_link_delete;
DROP TRIGGER csv_epoch_definition_insert;
DROP TRIGGER csv_epoch_definition_update;
DROP TRIGGER csv_epoch_definition_delete;
DROP TABLE csv_customer_epochs;
CREATE TRIGGER csv_run_contact_insert AFTER INSERT ON contacts
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_contact_update AFTER UPDATE ON contacts
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_contact_delete AFTER DELETE ON contacts
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=OLD.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_company_insert AFTER INSERT ON companies
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_company_update AFTER UPDATE ON companies
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_company_delete AFTER DELETE ON companies
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=OLD.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_domain_insert AFTER INSERT ON company_domains
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_domain_update AFTER UPDATE ON company_domains
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_domain_delete AFTER DELETE ON company_domains
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=OLD.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_link_insert AFTER INSERT ON contact_companies
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_link_update AFTER UPDATE ON contact_companies
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_link_delete AFTER DELETE ON contact_companies
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=OLD.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_definition_insert AFTER INSERT ON company_attribute_definitions
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_definition_update AFTER UPDATE ON company_attribute_definitions
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=NEW.project_id AND status IN ('preview','applied'); END;
CREATE TRIGGER csv_run_definition_delete AFTER DELETE ON company_attribute_definitions
BEGIN UPDATE csv_customer_imports SET revision=revision+1 WHERE project_id=OLD.project_id AND status IN ('preview','applied'); END;
