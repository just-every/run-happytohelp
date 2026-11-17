import React from 'react';
import {Link} from '@tanstack/react-router';
import AiKeyHandoff from '../setup-help/AiKeyHandoff';
const names=['OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','XAI_API_KEY','OPENROUTER_API_KEY'];
export default function ProviderSetupNotice({projectId,secretName,error}) {
 const matched=names.find(name=>name===secretName||String(error?.message||error||'').includes(name));
 return <section className="provider-setup-handoff" aria-label="AI provider setup"><AiKeyHandoff secretName={matched}/>{projectId&&<p><Link to={`/projects/${projectId}/ais`}>AI settings</Link></p>}</section>;
}
