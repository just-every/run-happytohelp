import { env } from 'cloudflare:workers';
import { getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { app } from '../app';
import type { Env } from './env';
import {readWorkspace} from '../ui/native/dashboard-bootstrap-reads';
import type { DashboardBootstrapInput, DashboardBootstrapResult, InitialReadOutcome } from '../ui/native/dashboard-bootstrap';

/** Fixed native reads under the caller's real origin and credentials. No
 * internal response cookie is forwarded, and no workspace switch runs here. */
export async function dashboardBootstrap(input: DashboardBootstrapInput): Promise<DashboardBootstrapResult> {
    const request = getRequest();
    let bindings = env as unknown as Env;
    if (import.meta.env.DEV && import.meta.env.RER_LOCAL_ORIGIN && bindings.H2H_LOCAL === 'true' && !bindings.RER_INSTALLATION_ID) {
        bindings = { ...bindings, APP_ORIGIN: import.meta.env.RER_LOCAL_ORIGIN };
    }
    setResponseHeader('Cache-Control', 'no-store');

    const read = async (path: string): Promise<InitialReadOutcome> => {
        try {
            const response = await app.fetch(new Request(new URL(path, request.url), {
                headers: request.headers, signal: request.signal,
            }), bindings);
            const body = await response.json() as any;
            if (response.ok) return { result: body };
            const retryAfter = Number(response.headers.get('Retry-After'));
            return { error: {
                status: response.status,
                message: body.error?.message || body.error || `Request failed (${response.status})`,
                data: body,
                ...(retryAfter > 0 ? { retryAfter } : {}),
            } };
        } catch (error) {
            return { error: { message: error instanceof Error ? error.message : String(error) } };
        }
    };
    return readWorkspace(input, read);
}
