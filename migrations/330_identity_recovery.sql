-- Live capabilities never travel. Keep the monotonic watermark on code rollback.
CREATE TABLE identity_recovery_authority(singleton INTEGER PRIMARY KEY CHECK(singleton=1),watermark INTEGER NOT NULL DEFAULT 0,acknowledged_generation INTEGER);
INSERT INTO identity_recovery_authority VALUES(1,0,NULL);
CREATE TABLE identity_recovery_nonces(nonce TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE INDEX identity_recovery_nonces_expiry ON identity_recovery_nonces(expires_at);
CREATE TABLE identity_recovery_epochs(user_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE identity_recovery_requests(
 id TEXT PRIMARY KEY,capability_hash TEXT NOT NULL UNIQUE,mode TEXT NOT NULL CHECK(mode IN ('managed','manual','account')),
 user_id TEXT NOT NULL,project_id TEXT NOT NULL,installation_id TEXT NOT NULL,app_origin TEXT NOT NULL,platform_origin TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL,key_hash TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','authorized','cancelled','expired','completed','refused')),
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,challenge_exp INTEGER,authorized_at INTEGER,
 proof_id TEXT UNIQUE,completion_id TEXT UNIQUE,pending_id TEXT,pending_secret TEXT,passkey_challenge TEXT,passkey_expires INTEGER
);
CREATE INDEX identity_recovery_requests_expiry ON identity_recovery_requests(expires_at);
CREATE INDEX identity_recovery_requests_user ON identity_recovery_requests(user_id,state,expires_at);
CREATE TABLE identity_recovery_approvals(request_id TEXT NOT NULL REFERENCES identity_recovery_requests(id) ON DELETE CASCADE,project_id TEXT NOT NULL,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,factor_at INTEGER NOT NULL,approver_epoch INTEGER NOT NULL,PRIMARY KEY(request_id,project_id));
CREATE TABLE identity_recovery_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start INTEGER NOT NULL);
CREATE INDEX identity_recovery_limits_expiry ON identity_recovery_limits(window_start);
CREATE TABLE identity_recovery_events(id TEXT PRIMARY KEY,request_id TEXT,user_id TEXT,action TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX identity_recovery_events_at ON identity_recovery_events(at);
-- A failed predicate aborts the entire D1 batch, including every credential write.
CREATE TABLE identity_recovery_assertions(ok INTEGER NOT NULL CHECK(ok=1));
CREATE TRIGGER identity_recovery_memberships_0 AFTER INSERT ON memberships BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_memberships_1 AFTER DELETE ON memberships BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_memberships_2 AFTER UPDATE ON memberships BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_credentials_0 AFTER INSERT ON credentials BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_credentials_1 AFTER DELETE ON credentials BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_credentials_2 AFTER UPDATE OF password_hash ON credentials BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_user_factors_0 AFTER INSERT ON user_factors BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_user_factors_1 AFTER DELETE ON user_factors BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_user_factors_2 AFTER UPDATE OF kind,secret_ciphertext,credential_id,public_key,confirmed_at ON user_factors BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
CREATE TRIGGER identity_recovery_users_0 AFTER UPDATE OF email ON users BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(NEW.id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
-- An in-place move between principals invalidates both sides, just like delete/insert.
CREATE TRIGGER identity_recovery_membership_old AFTER UPDATE OF user_id ON memberships WHEN OLD.user_id<>NEW.user_id BEGIN INSERT INTO identity_recovery_epochs(user_id,epoch) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1; END;
