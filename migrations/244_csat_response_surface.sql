-- Keep the invitation transport separate from the signed response surface.
-- Existing email links remain valid; widget surface is derived from its channel.
ALTER TABLE csat_responses ADD COLUMN response_surface TEXT NOT NULL DEFAULT 'unknown' CHECK(response_surface IN ('email','portal','widget','unknown'));
ALTER TABLE csat_response_history ADD COLUMN response_surface TEXT NOT NULL DEFAULT 'unknown' CHECK(response_surface IN ('email','portal','widget','unknown'));
