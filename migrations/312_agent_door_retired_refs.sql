-- Base bb81810f74ae5cbad9cd786ac84ee738306f63de: agent-door retirement suppression.
-- Earlier door columns and relay objects are already added by migration 298.
CREATE TABLE IF NOT EXISTS agent_door_retired_refs (digest TEXT PRIMARY KEY, marker TEXT NOT NULL);
