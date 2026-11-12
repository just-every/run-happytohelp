/** Stable, content-free refusals at the package boundary. Never return engine exceptions. */
export class WorkerImportError extends Error {
 constructor(readonly code:string,readonly status=409){super(code)}
}
export function refuse(code:string,status=409):never{throw new WorkerImportError(code,status)}
