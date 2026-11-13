/** Shared SQL only: safe for the disk CLI without importing Worker custody runtime. */
export const scopeAllowed=(scope:string)=>`NOT EXISTS(SELECT 1 FROM legacy_package_scope_fences WHERE project_id=${scope}) AND NOT EXISTS(SELECT 1 FROM contact_erasures WHERE project_id=${scope}) AND NOT EXISTS(SELECT 1 FROM contact_erasure_leases WHERE project_id=${scope})`
