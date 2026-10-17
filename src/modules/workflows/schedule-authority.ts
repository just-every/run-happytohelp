/** Only the durable scheduler can construct this server-side admission proof. */
export const scheduledAdmission=Symbol('scheduled-reply-admission')
export type ScheduledAdmission={sql:string;params:unknown[]}
