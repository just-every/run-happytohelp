-- One explicit native project per Business installation. Native owner setup writes it.
CREATE TABLE h2h_business_project (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 project_id TEXT NOT NULL REFERENCES projects(id),
 owner_user_id TEXT NOT NULL REFERENCES users(id)
);
-- Attribution is retained separately from mutable person display/email and provider receipts.
CREATE TABLE h2h_agent_operations (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL,tool TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,agent_name TEXT NOT NULL,sponsor_id TEXT NOT NULL,sponsor_name TEXT NOT NULL,
 approvers_json TEXT NOT NULL,at INTEGER NOT NULL,result_json TEXT NOT NULL
);
CREATE INDEX h2h_agent_operations_target ON h2h_agent_operations(project_id,target_type,target_id,at);

-- The original native claim links its single workspace; ambiguous upgrades require
-- an explicit current-owner project link instead of enrolling every workspace.
INSERT INTO h2h_business_project(singleton,project_id,owner_user_id)
 SELECT 1,min(m.project_id),o.claim_id FROM owner_setup o JOIN memberships m ON m.user_id=o.claim_id AND m.role='owner'
 GROUP BY o.claim_id HAVING count(*)=1;
CREATE TRIGGER h2h_business_native_claim AFTER INSERT ON memberships
 WHEN NEW.role='owner' AND EXISTS(SELECT 1 FROM owner_setup WHERE claim_id=NEW.user_id)
 BEGIN
 INSERT INTO h2h_business_project(singleton,project_id,owner_user_id) VALUES(1,NEW.project_id,NEW.user_id) ON CONFLICT(singleton) DO NOTHING;
 END;
