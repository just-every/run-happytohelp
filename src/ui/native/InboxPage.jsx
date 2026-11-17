import React from 'react';
import WidgetAddressNotice from './widget-setup/WidgetAddressNotice';
import Chat from '../dashboard/components/Chat';
import { Provider } from '../dashboard/contexts/ChatContext';
import { workspaceScopeKey } from './workspace-scope';

export default function InboxPage({ settings, Conversation }) {
    const scopeKey = workspaceScopeKey(settings);
    const initial = settings.initialInboxReads;
    const initialActiveConversationId = initial?.matches({projectId: settings.project?.id, conversationId: initial.conversationId, path: settings.dashboardLocation?.pathname}) ? initial.conversationId : undefined;
    return <Provider key={scopeKey} {...settings} activeConversationId={initialActiveConversationId} conversationLists={{}} conversationData={{}} projectId={settings.project?.id}>
        <div className="main-content inbox-with-header"><header className="inbox-workspace-header"><h1 className="visually-hidden">Inbox</h1><WidgetAddressNotice projectId={settings.project?.id}/></header><div id="chat"><Chat Conversation={Conversation} /></div></div>
    </Provider>;
}
