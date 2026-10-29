import type { Bindings } from '../bindings.server'
export function localDevelopmentEnabled(env: Pick<Bindings, 'AUTH_LOCAL' | 'AUTH_ORIGIN'>): boolean;
