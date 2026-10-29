import KnowledgeProposals from './KnowledgeProposals';
import React, { useState } from 'react';
import { useNavigationGuard } from '../../NavigationGuard';
import KnowledgeLists from './KnowledgeLists';
import KnowledgeExperience from './KnowledgeExperience';
import KnowledgeAnalytics from './KnowledgeAnalytics';

export default function KnowledgeWorkspace(props) {
    const [panel, setPanel] = useState('articles');
    const { confirmNavigation } = useNavigationGuard();
    return <>
        <nav className="knowledge-workspace-tabs" aria-label="Help Center tools">
            {[['articles', 'Articles'], ['experience', 'Help Center settings'], ['analytics', 'Article analytics'], ['proposals','Review proposals']].map(([value, label]) => <button key={value} type="button" className={'btn ' + (panel === value ? 'btn-white' : 'btn-link')} aria-pressed={panel === value} onClick={() => { if (panel !== value && confirmNavigation()) setPanel(value); }}>{label}</button>)}
        </nav>
        {panel === 'articles' && <KnowledgeLists {...props}/>}
        {panel === 'experience' && <KnowledgeExperience projectId={props.projectId} project={props.project} articles={props.items}/>}
        {panel === 'proposals' && <KnowledgeProposals key={props.projectId} projectId={props.projectId} categories={props.categories}/>}
        {panel === 'analytics' && <KnowledgeAnalytics projectId={props.projectId}/>}
    </>;
}
