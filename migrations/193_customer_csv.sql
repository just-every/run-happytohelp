-- CSV stores normalized plans and reversible images; source files are never retained.
CREATE TABLE csv_customer_epochs(project_id TEXT PRIMARY KEY REFERENCES projects(id),revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE csv_customer_imports(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL CHECK(kind IN ('contacts','companies')),
 status TEXT NOT NULL CHECK(status IN ('preview','applied','undone','erased')),epoch INTEGER NOT NULL,actor_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,applied_at INTEGER,undone_at INTEGER
);
CREATE INDEX csv_customer_imports_project ON csv_customer_imports(project_id,created_at);
CREATE TABLE csv_customer_import_rows(
 run_id TEXT NOT NULL REFERENCES csv_customer_imports(id) ON DELETE CASCADE,project_id TEXT NOT NULL REFERENCES projects(id),
 row_number INTEGER NOT NULL,action TEXT NOT NULL CHECK(action IN ('create','update','skip')),reason TEXT NOT NULL,
 entity_id TEXT,data_json TEXT NOT NULL CHECK(json_valid(data_json)),domain_match_json TEXT NOT NULL CHECK(json_valid(domain_match_json)),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 erased INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(run_id,row_number)
);
CREATE INDEX csv_customer_import_rows_entity ON csv_customer_import_rows(project_id,entity_id);
-- CHECK aborts the entire D1 batch if the preview, authority or undo fence is stale.
CREATE TABLE csv_customer_assertions(ok INTEGER NOT NULL CHECK(ok=1));

CREATE TRIGGER csv_epoch_contact_insert AFTER INSERT ON contacts BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_contact_update AFTER UPDATE ON contacts BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_contact_delete AFTER DELETE ON contacts BEGIN INSERT INTO csv_customer_epochs VALUES(OLD.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_company_insert AFTER INSERT ON companies BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_company_update AFTER UPDATE ON companies BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_company_delete AFTER DELETE ON companies BEGIN INSERT INTO csv_customer_epochs VALUES(OLD.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_domain_insert AFTER INSERT ON company_domains BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_domain_update AFTER UPDATE ON company_domains BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_domain_delete AFTER DELETE ON company_domains BEGIN INSERT INTO csv_customer_epochs VALUES(OLD.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_link_insert AFTER INSERT ON contact_companies BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_link_update AFTER UPDATE ON contact_companies BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_link_delete AFTER DELETE ON contact_companies BEGIN INSERT INTO csv_customer_epochs VALUES(OLD.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_definition_insert AFTER INSERT ON company_attribute_definitions BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_definition_update AFTER UPDATE ON company_attribute_definitions BEGIN INSERT INTO csv_customer_epochs VALUES(NEW.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER csv_epoch_definition_delete AFTER DELETE ON company_attribute_definitions BEGIN INSERT INTO csv_customer_epochs VALUES(OLD.project_id,1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1; END;

-- Runs containing erased identity cannot be replayed or reversed. Scrub even
-- invalid/duplicate rows and previews made before the contact existed.
CREATE TRIGGER csv_contact_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN json_extract(NEW.metadata_json,'$.is_erasing')=1 OR json_extract(NEW.metadata_json,'$.is_erased')=1
BEGIN
 UPDATE csv_customer_imports SET status='erased' WHERE project_id=NEW.project_id AND kind='contacts' AND id IN (
  SELECT run_id FROM csv_customer_import_rows WHERE project_id=NEW.project_id AND (
   entity_id=NEW.id OR lower(json_extract(data_json,'$.email'))=lower(OLD.email) OR json_extract(data_json,'$.externalId')=OLD.external_id
   OR lower(json_extract(before_json,'$.email'))=lower(OLD.email) OR lower(json_extract(after_json,'$.email'))=lower(OLD.email))
 );
 UPDATE csv_customer_import_rows SET data_json='{}',domain_match_json='null',before_json='null',after_json='null',reason='Contact erased',erased=1
 WHERE project_id=NEW.project_id AND run_id IN (SELECT id FROM csv_customer_imports WHERE project_id=NEW.project_id AND kind='contacts') AND (
  entity_id=NEW.id OR lower(json_extract(data_json,'$.email'))=lower(OLD.email) OR json_extract(data_json,'$.externalId')=OLD.external_id
  OR lower(json_extract(before_json,'$.email'))=lower(OLD.email) OR lower(json_extract(after_json,'$.email'))=lower(OLD.email)
 );
END;
