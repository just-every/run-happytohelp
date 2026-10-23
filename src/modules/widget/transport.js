/** Only preferences belong in JSON. Network and device context comes from the request. */
const contactEnvironment = () => ({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  language: typeof navigator === 'undefined' ? undefined : navigator.language,
});

/** Native, tenant-scoped browser transport. No dashboard dependency. */
export class WidgetTransport {
  constructor({ apiOrigin, widgetKey, onEvent = () => {}, onError = () => {} }) {
    const origin = new URL(apiOrigin);
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('Widget API requires HTTPS');
    if (!widgetKey) throw new Error('A widgetKey is required');
    this.origin = origin.origin; this.widgetKey = widgetKey;
    this.onEvent = onEvent; this.onError = onError;
    this.storageKey = `rer-widget:${this.origin}:${widgetKey}`;
    this.closed = false; this.eventId = 0; this.revision = 0; this.lastMessageId = null;
    this.abort = new AbortController();
    this.pending = new Map(); this.mediaURLs = new Map();
  }
  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (this.session?.token) headers.set('Authorization', `Bearer ${this.session.token}`);
    if (options.json !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.origin}${path}`, {...options, signal: this.abort.signal, headers, body: options.json !== undefined ? JSON.stringify(options.json) : options.body});
    const contentType = response.headers.get('Content-Type') || '';
    const result = contentType.includes('application/json') ? await response.json() : {message: await response.text()};
    if (response.status === 429) {
      // Server limits carry a visitor-readable message and a retry delay; they never mean the widget is broken.
      const retryAfter = Number(result.retryAfter ?? response.headers.get('Retry-After')) || null;
      throw Object.assign(new Error(result.error || 'Please wait a moment and try again.'), {status: 429, rateLimited: true, retryAfter, detail: result});
    }
    if (!response.ok) throw Object.assign(new Error(result.message || result.error || `Request failed (${response.status})`), {status: response.status, code: result.code, detail: result});
    return result;
  }
  async connect(contact = {}) {
    if (this.closed) throw new Error('Widget connection is closed');
    if (this.revoked) throw this.revoked;
    if (this.connecting) return this.connecting;
    this.connecting = this.initialize(contact).catch(error => { this.connecting = null; throw error; });
    return this.connecting;
  }
  async reconnect(contact = {}) {
    if (this.reconnecting) return this.reconnecting;
    clearTimeout(this.timer);
    this.reconnecting = (async () => {
      const socket = this.socket;
      const session = await this.connect(contact);
      // Initialization already opens its socket. An admitted session needs a
      // new handshake even when the browser still reports its old socket open.
      if (this.socket === socket || !this.socket || this.socket.readyState >= 2) {
        await this.refresh();
        if (this.closed) throw new Error('Widget connection is closed');
        if (this.revoked) throw this.revoked;
        this.openSocket();
      }
      return session;
    })();
    try { return await this.reconnecting; } finally { this.reconnecting = null; }
  }
  async initialize(contact) {
    let configuration;
    this.settingsPath = `/api/widget/settings?widgetKey=${encodeURIComponent(this.widgetKey)}${contact?.preview_token ? `&previewToken=${encodeURIComponent(contact.preview_token)}` : ""}`;
    try {
      configuration = await this.request(this.settingsPath);
    } catch (error) {
      if (error.status === 403 || error instanceof TypeError) {
        throw new Error(`Support could not connect on ${location.origin}. Site owner: open HappyToHelp > Settings > Widget and allow this exact Website origin. Also check that the HappyToHelp address is reachable.`);
      }
      throw error;
    }
    this.configuration = configuration;
    this.onEvent({type: 'configuration', configuration});
    try { this.session = JSON.parse(localStorage.getItem(this.storageKey)); } catch { this.session = null; }
    const signedIdentity = contact.hash ? contact.identifier || contact.email : null;
    if (!this.session?.token || signedIdentity && this.session.verifiedIdentity !== signedIdentity) {
      this.session = await this.request('/api/identity/widget/session', {method: 'POST', json: {...contactEnvironment(), widgetKey: this.widgetKey, name: contact.name || contact.provided_name, email: contact.email, provided_name: contact.provided_name, provided_email: contact.provided_email, identifier: contact.identifier, contact_hash: contact.hash, metadata: contact.metadata, previewToken: contact.preview_token}});
      if (this.session.verified && signedIdentity) this.session.verifiedIdentity = signedIdentity;
      localStorage.setItem(this.storageKey, JSON.stringify(this.session));
    }
    // Contact details are current private server data, never part of the
    // persisted browser session. Check authority before resolving a conversation.
    const profile = await this.request('/api/identity/widget/profile');
    if (!this.session.conversationId) {
      const existing = await this.request('/api/conversations');
      const conversation = existing.conversations?.[0] || await this.request('/api/conversations', {method: 'POST', json: {projectId: this.session.projectId}});
      this.session.conversationId = (conversation.conversation || conversation).id;
      localStorage.setItem(this.storageKey, JSON.stringify(this.session));
    }
    this.conversationId = this.session.conversationId;
    await this.refresh();
    if (!this.closed) {
      this.onEvent({type: 'session', session: this.session, contact: profile.contact});
      this.openSocket();
    }
    return this.session;
  }
  // A closed ticket is final: the server admits the visitor's next turn into its linked follow-up, which this widget follows from then on.
  follow(conversationId) {
    if (!conversationId || conversationId === this.conversationId) return false;
    this.session.conversationId = this.conversationId = conversationId; this.revision = 0; this.lastMessageId = null; this.eventId = 0;
    localStorage.setItem(this.storageKey, JSON.stringify(this.session));
    this.onEvent({type: 'session', session: this.session});
    this.openSocket();
    return true;
  }
  // Settings again, when the team's availability changes while the widget is open.
  async refreshConfiguration() {
    if (!this.settingsPath || this.closed) return;
    this.configuration = await this.request(this.settingsPath);
    this.onEvent({type: 'configuration', configuration: this.configuration});
  }
  async refresh() {
    const result = await this.request(`/api/conversations/${this.conversationId}/messages`);
    if (result.mergedInto && result.mergedInto !== this.conversationId) {
      this.socket?.close(); this.conversationId = result.mergedInto;
      this.session.conversationId = result.mergedInto; this.revision = 0; this.lastMessageId = null; this.eventId = 0;
      localStorage.setItem(this.storageKey, JSON.stringify(this.session));
      const transcript = await this.refresh();
      this.onEvent({type:'session',session:this.session});
      if (!this.closed) this.openSocket();
      return transcript;
    }
    if (result.revision >= this.revision) {this.revision = result.revision; this.lastMessageId = result.lastMessageId;}
    if (result.widget) this.onEvent({type:'settings',payload:result.widget});
    this.onEvent({type: 'transcript', resolution: result.resolution || null, messages: await Promise.all(result.messages.map(message => this.message(message)))});
    return result;
  }
  async message(message) {
    const media = await Promise.all((message.media || []).map(async item => {
      let url = this.mediaURLs.get(item.id);
      if (!url) {
        const response = await fetch(`${this.origin}/api/conversations/${this.conversationId}/media/${item.id}`, {signal: this.abort.signal, headers: {Authorization: `Bearer ${this.session.token}`}});
        if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
        url = URL.createObjectURL(new Blob([await response.arrayBuffer()], {type: item.content_type || 'application/octet-stream'})); this.mediaURLs.set(item.id, url);
      }
      return {...item, url, preview_url: url, filename_original: item.filename || item.name, aggregate_type: (item.content_type || item.mime_type || '').startsWith('image/') ? 'image' : 'file'};
    }));
    const ai = message.actor_role === 'ai' ? this.configuration?.ais?.find(person => person.id === message.actor_id) : null;
    const agent = ai ? {...ai, is_ai:true, ai} : message.actor_role === 'system' ? this.workspaceAuthor(message.actor_id) : message.actor_role !== 'contact' ? this.configuration?.agents?.find(person => person.id === message.actor_id) : undefined;
    return {...message, ...(agent ? {agent} : {}), created_at: typeof message.created_at === 'number' ? new Date(message.created_at).toISOString() : message.created_at, local_id: message.local_id || message.localId, contact_id: message.actor_role === 'contact' ? this.session.contactId : message.contact_id, agent_id: message.actor_role && message.actor_role !== 'contact' ? message.actor_id : message.agent_id, media};
  }
  // The workspace itself, as the author of its away reply.
  workspaceAuthor(id) {
    const brand = this.configuration?.brand || {}, name = brand.name || this.configuration?.project?.name || 'Support';
    return {id, name, initials: name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(), ...(brand.avatar_url || brand.logo_url ? {avatar_url: brand.avatar_url || brand.logo_url} : {})};
  }
  openSocket() {
    if (this.closed || this.revoked) return;
    clearTimeout(this.timer);
    const previous = this.socket;
    const url = new URL(`/api/conversations/${this.conversationId}/socket`, this.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.session.token); url.searchParams.set('after', String(this.eventId));
    const socket = new WebSocket(url); this.socket = socket;
    const active = () => this.socket === socket && !this.closed && !this.revoked;
    previous?.close();
    socket.onopen = () => {
      if (!active()) return;
      this.retry = 0; this.onEvent({type: 'connected'});
      this.refresh().then(() => { if (active()) return this.replayPending(); }).catch(error => { if (active()) this.onError(error); });
    };
    socket.onmessage = event => this.inbound = Promise.resolve(this.inbound).then(async () => {
      if (!active()) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.eventId && payload.eventId <= this.eventId) return;
        if (payload.message) payload.message = await this.message(payload.message);
        if (!active()) return;
        this.onEvent(payload);
        if (payload.type === 'message') await this.refresh();
        if (payload.eventId) this.eventId = payload.eventId;
      } catch(error) { if (active()) this.onError(error); }
    });
    socket.onclose = event => {
      if (!active()) return;
      this.socket = null;
      this.onEvent({type: 'disconnected'});
      if (event?.code === 1008) {
        this.revoked = new Error('Conversation session was revoked');
        clearTimeout(this.timer); this.onError(this.revoked); return;
      }
      this.timer = setTimeout(() => this.openSocket(), Math.min(1000 * 2 ** (this.retry = (this.retry || 0) + 1), 15000));
    };
    socket.onerror = () => { if (active()) this.onError(new Error('Conversation connection interrupted')); };
  }
  async send(data) {
    await this.connect();
    if (this.pending.has(data.local_id)) return this.pending.get(data.local_id);
    const operation = (async () => {
      this.session.pendingCommands ||= {};
      let command = this.session.pendingCommands[data.local_id];
      if (!command) {
        await this.refresh();
        command = {localId: data.local_id, content: data.content, expectedRevision: this.revision, expectedLastMessageId: this.lastMessageId, mediaIds: [...(data.media_ids || [])]};
        this.session.pendingCommands[data.local_id] = command;
        localStorage.setItem(this.storageKey, JSON.stringify(this.session));
      } else if (command.content !== data.content || JSON.stringify(command.mediaIds) !== JSON.stringify(data.media_ids || [])) {
        throw new Error('A pending message identity cannot be reused with different content or attachments');
      }
      let result;
      for (let admissionAttempt = 0; admissionAttempt < 2; admissionAttempt++) {
        try { result = await this.request(`/api/conversations/${this.conversationId}/messages`, {method: 'POST', json: command}); break; }
        catch (error) {
          if (error.rateLimited) {
            // Refused before admission: forget the command so it is never sent later without the visitor.
            delete this.session.pendingCommands[data.local_id];
            localStorage.setItem(this.storageKey, JSON.stringify(this.session));
            error.definitiveRejection = true;
            throw error;
          }
          if (error.status !== 409 || error.detail?.accepted !== false) throw error;
          delete this.session.pendingCommands[data.local_id];
          localStorage.setItem(this.storageKey, JSON.stringify(this.session));
          error.definitiveRejection = true;
          if (admissionAttempt || error.detail.reason !== 'conversation_changed_or_admission_denied') throw error;
          const transcript = await this.refresh();
          if (transcript.messages.some(message => message.local_id === data.local_id)) throw error;
          command = {...command, expectedRevision: this.revision, expectedLastMessageId: this.lastMessageId};
          this.session.pendingCommands[data.local_id] = command;
          localStorage.setItem(this.storageKey, JSON.stringify(this.session));
        }
      }
      delete this.session.pendingCommands[data.local_id];
      localStorage.setItem(this.storageKey, JSON.stringify(this.session));
      this.follow(result.followupConversationId);
      if (result.message) this.onEvent({type: 'message', message: await this.message(result.message)});
      await this.refresh();
      return result;
    })();
    this.pending.set(data.local_id, operation);
    try { return await operation; } finally { this.pending.delete(data.local_id); }
  }
  async replayPending() {
    for (const command of Object.values(this.session.pendingCommands || {})) {
      if (this.closed || this.revoked) return;
      try { await this.send({local_id: command.localId, content: command.content, media_ids: command.mediaIds}); }
      catch(error) { this.onError(error); if (!error.definitiveRejection) throw error; }
    }
  }
  async upload(file) {
    await this.connect();
    const media = await this.request(`/api/conversations/${this.conversationId}/media`, {method: 'POST', headers: {'Content-Type': file.type || 'application/octet-stream', 'X-Filename': file.name.replace(/[^\x20-\x7E]/g, '_')}, body: file});
    return {data: media.media || media};
  }
  async action(action, data) {
    await this.connect();
    return this.request(`/api/conversations/${this.conversationId}/widget-events`, {method: 'POST', json: {action, data: ['pingActive', 'pingAction', 'instruction'].includes(action) ? {opened: data?.opened, value: data?.value, ...contactEnvironment()} : data}});
  }
  close() {
    this.closed = true; this.abort.abort(); clearTimeout(this.timer); this.socket?.close();
    for (const url of this.mediaURLs.values()) URL.revokeObjectURL(url);
    this.mediaURLs.clear();
  }
}
