/** A restored/disabled external principal cannot use a native session to regain
 * provider-owned membership. Other native memberships and native owners survive. */
export function activeEnterpriseMember(user:string,project:string){return `NOT EXISTS(SELECT 1 FROM enterprise_principals ep LEFT JOIN enterprise_connections ec ON ec.id=ep.connection_id WHERE ep.user_id=${user} AND ep.project_id=${project} AND (ep.active<>1 OR COALESCE(ec.enabled,0)<>1))`}
export const activeEnterpriseSession=`NOT EXISTS(SELECT 1 FROM enterprise_sessions es WHERE es.token_hash=s.token_hash AND NOT EXISTS(SELECT 1 FROM enterprise_principals ep JOIN enterprise_connections ec ON ec.id=ep.connection_id WHERE ep.id=es.principal_id AND ep.active=1 AND ec.enabled=1 AND ec.version=es.connection_version))`
