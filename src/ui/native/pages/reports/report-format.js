export const reportCount = value => new Intl.NumberFormat().format(value);

export function reportDuration(milliseconds) {
    if (milliseconds == null) return '—';
    if (milliseconds === 0) return '0 min';
    if (milliseconds < 60000) return `${Math.round(milliseconds / 1000)} sec`;
    if (milliseconds < 3600000) return `${Number((milliseconds / 60000).toFixed(1))} min`;
    return `${Number((milliseconds / 3600000).toFixed(1))} hr`;
}

export const reportPercent = value => value == null ? '—' : `${Number((value * 100).toFixed(1))}%`;

export const reportEndpoint = projectId => `/api/dashboard/projects/${encodeURIComponent(projectId)}/reports/team`;
