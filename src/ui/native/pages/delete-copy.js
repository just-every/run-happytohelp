// What each destructive delete does, in the words shown by the shared confirmation dialog.
const named = (noun, value) => `${noun}${value ? ` “${value}”` : ''}`;
export const deleteCopy = {
    contacts: {title: record => `Delete ${named('contact', record.provided_name || record.name || record.email)}?`, effect: 'The contact is removed from your contact list, blocked from sending new messages, and signed out of the widget. Their existing conversations stay in place. To permanently remove their personal data, use Erase personal data instead.'},
    ais: {title: record => `Delete ${named('AI assistant', record.name)}?`, effect: 'Its name, prompt and settings are permanently removed and it can no longer respond. This cannot be undone.'},
    plugins: {title: record => `Delete ${named('plugin', record.name)}?`, effect: 'The plugin is removed for everyone in this project. This cannot be undone.'},
    agents: {title: record => `Remove ${named('member', record.name || record.email)} from this project?`, effect: 'They lose access to this project immediately and their sessions end. They can be invited again later.'},
    articles: {title: record => `Delete ${named('article', record.title)}?`, effect: 'The article is permanently removed from your help center. This cannot be undone.'},
    categories: {title: record => `Delete ${named('category', record.title || record.name)}?`, effect: 'Articles in this category are kept but lose the category, and its subcategories move to the top level. This cannot be undone.'},
    datasets: {title: record => `Delete ${named('website', record.url || record.name)}?`, effect: 'The website and every page your AI has learned from it are permanently removed. This cannot be undone.'},
};
