-- Keep a fresh restore destination empty: inventory is operational state, created
-- lazily by the first bounded discovery. Missing state remains cleanup-pending.
-- Never discard a cursor or an installation's existing package/run inventory.
DELETE FROM legacy_package_v1_inventory
WHERE singleton=1 AND complete=0 AND list_cursor=''
 AND NOT EXISTS(SELECT 1 FROM legacy_package_custody)
 AND NOT EXISTS(SELECT 1 FROM legacy_import_worker_runs);
