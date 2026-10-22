import React from 'react';
import { Link } from '@tanstack/react-router';
import { PageHeaderTabs } from '../../PageHeader';

const tabs = [
    ['reports', 'Reports'],
    ['insights', 'Insights'],
];

/** Reports and Insights share the rail's one Reports row; these tabs move between them. */
export default function ReportsTabs({ projectId, activeSection }) {
    return <PageHeaderTabs>
        <nav aria-label="Reports sections">
            <ul className="nav nav-tabs header-tabs">
                {tabs.map(([section, label]) => {
                    const active = section === activeSection;
                    return <li className="nav-item" key={section}>
                        <Link
                            className={`nav-link${active ? ' active' : ''}`}
                            aria-current={active ? 'page' : undefined}
                            to={`/projects/${projectId}/${section}`}
                        >{label}</Link>
                    </li>;
                })}
            </ul>
        </nav>
    </PageHeaderTabs>;
}
