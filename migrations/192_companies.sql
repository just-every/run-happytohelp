CREATE TABLE companies(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 name TEXT NOT NULL,
 attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json) AND json_type(attributes_json)='object'),
 portal_company_view INTEGER NOT NULL DEFAULT 0 CHECK(portal_company_view IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 merged_into TEXT REFERENCES companies(id),
 UNIQUE(project_id,id)
);
CREATE INDEX companies_project_name ON companies(project_id,name);
CREATE TABLE company_domains(
 project_id TEXT NOT NULL REFERENCES projects(id),
 domain TEXT NOT NULL,
 company_id TEXT NOT NULL,
 PRIMARY KEY(project_id,domain),
 FOREIGN KEY(project_id,company_id) REFERENCES companies(project_id,id)
);
CREATE INDEX company_domains_company ON company_domains(project_id,company_id);
CREATE TABLE contact_companies(
 project_id TEXT NOT NULL REFERENCES projects(id),
 contact_id TEXT NOT NULL REFERENCES contacts(id),
 company_id TEXT NOT NULL,
 PRIMARY KEY(project_id,contact_id),
 FOREIGN KEY(project_id,company_id) REFERENCES companies(project_id,id)
);
CREATE INDEX contact_companies_company ON contact_companies(project_id,company_id);
CREATE TABLE company_attribute_definitions(
 project_id TEXT NOT NULL REFERENCES projects(id),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('text','number','date','dropdown','checkbox')),
 options_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(options_json) AND json_type(options_json)='array'),
 PRIMARY KEY(project_id,id)
);
CREATE TABLE company_history(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 company_id TEXT NOT NULL,
 source_company_id TEXT,
 action TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 at INTEGER NOT NULL,
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 provenance_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provenance_json)),
 undone_by TEXT,
 FOREIGN KEY(project_id,company_id) REFERENCES companies(project_id,id)
);
CREATE INDEX company_history_company ON company_history(project_id,company_id,at);
CREATE INDEX company_history_source ON company_history(project_id,source_company_id);
