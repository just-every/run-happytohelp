import WorkflowPanel from './workflows/WorkflowPanel';
import TicketEditor from './tickets/TicketEditor';
import { useDashboardSettings } from '../../native/dashboard-state';
import ResolutionSummary from './conversation/ResolutionSummary';
import ConversationTags from './conversation/ConversationTags';
import SlateInquiryLink from '../../native/SlateInquiryLink';
import React, { useContext, useState } from 'react';
import PropTypes from 'prop-types';
import ContactUpdateModal from './ContactUpdateModal';
import MetadataItem from './MetadataItem';
import Api from '../api';
import { ChatContext } from '../contexts/ChatContext';
import usePluginMessageEvent from '../hooks/usePluginMessageEvent';
import EmailConversationTranscriptModal from './EmailConversationTranscriptModal';
import ConversationAssignmentControl from './conversation/ConversationAssignmentControl';
import ConversationParticipantsControl from './conversation/ConversationParticipantsControl';
import ConversationContactDetails from './conversation/ConversationContactDetails';
import ConversationDetailSection from './conversation/ConversationDetailSection';
import ConversationEnvironmentDetails from './conversation/ConversationEnvironmentDetails';

ConversationSidebar.propTypes = {
    conversation: PropTypes.object.isRequired,
};

export default function ConversationSidebar({ conversation }) {
    const settings = useDashboardSettings();
    const [ isContactModalVisible, setIsContactModalVisible ] = useState(false);
    const [ isEmailConversationTranscriptModalVisible, setIsEmailConversationTranscriptModalVisible ] = useState(false);
    const {
        updateConversation,
        plugins,
        pluginsRef,
    } = useContext(ChatContext);

    const handleBlock = block => {
        if (!confirm(`Are you sure you want to ${ block ? 'block' : 'unblock' } this contact?`)) {
            return;
        }

        Api.update(`/projects/${ conversation.project_id }/contacts/${ conversation.contact_id }`, { is_blocked: block })
            .then(data => {
                updateConversation(conversation.id, { contact: data.data });
            })
            .catch(error => {
                console.log(error);
            });
    };

    const handlePluginSetHeight = event => {
        pluginsRef.current.forEach(iframe => {
            if (!iframe) return;

            const pluginWindow = iframe.contentWindow || iframe.contentDocument.defaultView;
            if (pluginWindow === event.source) {
                iframe.height = event.data.payload;
            }
        });
    };

    usePluginMessageEvent(handlePluginSetHeight, 'setHeight');

    return <div className="conversation-details">
        <SlateInquiryLink conversation={ conversation } />
        {!(settings.projects?.[conversation.project_id] || settings.project)?.is_demo && <TicketEditor key={conversation.id} conversation={conversation}/>}
        {!(settings.projects?.[conversation.project_id] || settings.project)?.is_demo && <WorkflowPanel key={`workflows-${conversation.id}`} conversation={conversation}/>}
        <ConversationTags conversation={conversation}/>
        <ResolutionSummary resolution={conversation.resolution} history={conversation.resolutionHistory}/>
        <ConversationAssignmentControl conversation={ conversation } />
        <ConversationParticipantsControl conversation={ conversation } />
        <ConversationContactDetails
            conversation={ conversation }
            onEdit={ () => setIsContactModalVisible(true) }
            onEmailTranscript={ () => setIsEmailConversationTranscriptModalVisible(true) }
            onToggleBlock={ handleBlock }
        />
        <ConversationEnvironmentDetails contact={ conversation.contact } />
        { conversation.contact.metadata && <ConversationDetailSection className="conversation-details-metadata" title="Metadata">
            { Object.entries(conversation.contact.metadata).map(([key, value]) => (
                <MetadataItem key={ key } name={ key } value={ value } />
            )) }
        </ConversationDetailSection> }
        { plugins.map((plugin, index) => <ConversationDetailSection key={ plugin.id } className="conversation-details-plugin" title={ plugin.name }>
            <iframe
                id={ `plugin-${ plugin.id }` }
                ref={ element => { pluginsRef.current[index] = element; } }
                className="conversation-details-plugin__frame"
                src={ plugin.url }
                data-h2h-plugin-origin={new URL(plugin.url).origin}
                title={plugin.name}
                sandbox="allow-scripts allow-same-origin allow-forms"
                frameBorder="0"
                width="100%"
                height="500"
            ></iframe>
        </ConversationDetailSection>) }
        { isContactModalVisible && <ContactUpdateModal
            contact={ conversation.contact }
            conversation={ conversation }
            onHide={ () => setIsContactModalVisible(false) }
        /> }
        { isEmailConversationTranscriptModalVisible && <EmailConversationTranscriptModal
            conversation={ conversation }
            onHide={ () => setIsEmailConversationTranscriptModalVisible(false) }
        /> }
    </div>;
}
