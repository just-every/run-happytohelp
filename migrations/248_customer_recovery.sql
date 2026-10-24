-- A customer's explicit recovery answer is distinct from satisfaction.
-- Existing positive ratings establish no recovery claim.
ALTER TABLE csat_responses ADD COLUMN recovery TEXT NOT NULL DEFAULT 'unknown' CHECK(recovery IN ('unknown','recovered','not_recovered'));
ALTER TABLE csat_response_history ADD COLUMN recovery TEXT NOT NULL DEFAULT 'unknown' CHECK(recovery IN ('unknown','recovered','not_recovered'));
