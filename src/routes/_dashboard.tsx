import type { LinkHTMLAttributes } from 'react';
import { DashboardError } from '../ui/native/Dashboard';
import { checkNativeSession } from '../ui/identity/loaders';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { dashboardPath } from '../ui/native/dashboard-path';
import {projectIdFromPath} from '../ui/native/workspace-scope';

// Validate document paths on the server before entering the client-only workspace.
export const Route = createFileRoute('/_dashboard')({
    codeSplitGroupings: [],
    head: ({match}) => ({ links: [
        { rel: 'preload', href: '/fonts/outfit/outfit-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
        { rel: 'preload', href: '/homepage/media/brands/happytohelp-favicon.svg', as: 'image', type: 'image/svg+xml', crossOrigin: 'anonymous' },
        ...((match.context as {editorPreload?:boolean}).editorPreload ? [{rel:'preload',as:'fetch',href:'/api/identity/editor-config',crossOrigin:'anonymous' as const}] : []),
    ] satisfies LinkHTMLAttributes<HTMLLinkElement>[] }),
    headers: () => ({ 'Cache-Control': 'no-store' }),
    errorComponent: DashboardError,
    beforeLoad: async ({ location }) => {
        if (!dashboardPath.test(location.pathname)) throw notFound();
        const session = import.meta.env.SSR ? await checkNativeSession() : undefined;
        if (import.meta.env.SSR && !session) throw redirect({ to: '/login', search: { returnTo: location.href }, replace: true, headers: { 'Cache-Control': 'no-store' } });
        // A session whose second factor is unproven, or required but missing, finishes signing in first.
        if (session && session.twoFactor) throw redirect({ href: `/two-factor?returnTo=${encodeURIComponent(location.href)}`, replace: true, headers: { 'Cache-Control': 'no-store' } });
        const projectId = projectIdFromPath(location.pathname);
        return {editorPreload: Boolean(session && session.editorAuthorized && (!projectId || projectId === session.projectId))};
    },
});
