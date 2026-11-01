/** The server supplies only references and recipient labels the operator may see. */
export function knowledgeRefusalMessage(body) {
    if (body?.reason !== 'knowledge_access_denied') return null;
    const blocked = (body.blockedReferences || []).map(reference => {
        const recipients = (reference.recipients || []).filter(recipient => !recipient.visible).map(recipient => recipient.label);
        return `${reference.title ? `“${reference.title}”` : 'A knowledge reference'} is withheld from ${recipients.join(', ') || 'a recipient'}`;
    });
    return `${blocked.join('; ') || 'A knowledge reference is unavailable to the recipients'}. Remove it or change the recipients.`;
}
