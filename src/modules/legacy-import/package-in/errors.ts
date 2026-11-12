export class PackageError extends Error {
 constructor(public status:number,public code:string,message:string){super(message)}
}
export function refuse(status:number,code:string,message:string):never{throw new PackageError(status,code,message)}
