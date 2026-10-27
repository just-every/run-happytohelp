-- Revised proposals remain separate from accepted responsibility until review.
ALTER TABLE followup_obligations ADD COLUMN pending_terms_json TEXT;
ALTER TABLE followup_changes ADD COLUMN stop_condition TEXT;
ALTER TABLE followup_changes ADD COLUMN dependency_id TEXT;
