import {useCallback, useEffect, useRef, useState} from 'react';
import {nativeRequest} from '../transport';
import {useDashboardSettings} from '../dashboard-state';

export const crmRoot = projectId => `/api/management/projects/${encodeURIComponent(projectId)}/crm/hubspot`;
export function useCrmAccess(projectId) {
    const settings = useDashboardSettings(), project = settings.projects?.[projectId];
    const permissions = project?.access?.permissions || [];
    return {allowed: ['owner', 'admin'].includes(project?.role) && permissions.includes('contacts.manage'),
        writable: permissions.includes('integrations.install'),
        identity: JSON.stringify([settings.sessionVersion, project?.role, permissions])};
}

/** Each mounted resource owns its requests. Never retain content after a refused read or refresh. */
export function useCrmResource(path) {
    const [state, setState] = useState({loading: true, data: null, error: '', notice: ''});
    const request = useRef(null), serial = useRef(0), pending = useRef(false);
    const run = useCallback(async (init, notice = '', background = false) => {
        if (background && pending.current) return;
        request.current?.abort();
        const controller = new AbortController(), version = ++serial.current;
        request.current = controller;
        pending.current = true;
        setState(previous => ({...previous, loading: true, error: '', notice: background ? previous.notice : ''}));
        try {
            if (init) await nativeRequest(path + (init.suffix || ''), {...init, signal: controller.signal});
            const data = await nativeRequest(path, {signal: controller.signal});
            if (!controller.signal.aborted && serial.current === version) setState(previous => ({loading: false, data, error: '', notice: background ? previous.notice : notice}));
            return !controller.signal.aborted;
        } catch (error) {
            if (!controller.signal.aborted && serial.current === version) setState({loading: false, data: null, error: error.message, notice: '', denied: [401, 403].includes(error.status)});
            return false;
        } finally {
            if (serial.current === version) pending.current = false;
        }
    }, [path]);
    useEffect(() => {
        run();
        const check = () => { if (document.visibilityState === 'visible') run(undefined, '', true); };
        const timer = setInterval(check, 30000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
        return () => { ++serial.current; request.current?.abort(); clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
    }, [run]);
    return {...state, run};
}
export const crmJson = (method, body) => ({method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
