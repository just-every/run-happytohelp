// What the widget renders when a project saves nothing. The embedded widget and the
// dashboard's Widget settings editor both read these values, so the editor always shows
// the effective widget rather than blank or black placeholders.
// Colors are six-digit hex because the editor edits them with color inputs.
export const defaultTheme = {
    button: {
        closed: {
            background: "#484748",
            color: "#ffffff",
        },
        open: {
            background: "#f5f6fb",
            color: "#667085",
        },
    },
    avatar: {
        background: "#b2e2ff",
        color: "#24384b",
    },
    insight: {
        background: "#ffffff",
        color: "#333333",
    },
    window: {
        background: "#ffffff",
        color: "#000000",
    },
    chat: {
        agent: {
            background: "#f1f9ff",
            color: "#000000",
        },
        user: {
            background: "#2ca1e5",
            color: "#ffffff",
        },
    },
    input: {
        message: {
            background: "#f5f6fb",
            color: "#666666",
        },
        button: {
            color: "#667085",
        },
        send: {
            background: "#484748",
            color: "#ffffff",
        },
    },
};

export const defaultSettings = {
    await_consent: false,
    ai: {
        enabled: true,
        types: ['sales', 'support', 'billing'],
    },
    collector: {
        enabled: true,
        disable_bots: true,
    },
    button: {
        enabled: true,
    },
    show_glow: {
        on_insight: true,
        on_insight_reply: true,
        on_ai_typing: false,
        on_human_typing: false,
    },
    message: {
        collect_screenshot: true,
        collect_attachments: true,
    },
    collect: {
        require_name: false,
        require_email: false,
    }
};

export const defaultText = {
    errors: {
        connection: "Sorry we could not connect to the server. Please check your connection and try again.",
    },
    ai: {
        chat: "AI assisted conversation. Please verify important details.",
        selection: "Who would you prefer to talk to?",
        ai: "AI",
        ai_response: "Responds instantly",
        human: "Human",
        human_response: "Responds within 24 hours",
    },
    message: {
        placeholder_message: "Send a message...",
        placeholder_message_chat: "Message...",
        placeholder_files: "Drag your files here!",
        tooltip_contact: "Edit your details",
        tooltip_screenshot: "Send screenshot",
        tooltip_attach: "Send file",
        tooltip_send: "Send message",
        button_send: "Send",
        error_name: "Please enter your name",
        error_email: "Please enter a valid email address",
        error_message: "Please enter a message to send",
    },
    collect: {
        placeholder_name: "Your Name",
        placeholder_email: "you@example.com",
    },
    away: {
        title: "We're away right now",
        back: "We're back {when}.",
        email_ask: "Leave your email below and we'll send our reply there too.",
        email_known: "We'll reply here and email you at {email}.",
        header: "Away",
        header_back: "Away until {when}",
        email_prompt: "We'll email our reply to this address.",
    },
    prompt: {
        email_prompt: "Receive an email when {agent_name} replies!",
        edit_contact: "Edit your contact details below",
        placeholder_email: "you@example.com",
        validate_error: "Sorry, that email address does not appear to be valid. Please enter your email address.",
    },
    chat: {
        return_title: "Continue Conversation",
        return_last_message: "Last message",
        return_active: "Currently active",
        sending: "Sending...",
        sending_image: "Sending image...",
        sending_images: "Sending images...",
        sending_file: "Sending file...",
        sending_files: "Sending files...",
        failed: "Failed to send",
        sent: "Sent",
        received: "Received",
    }
};
