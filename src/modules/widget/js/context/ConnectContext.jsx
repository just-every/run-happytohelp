import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import AppContext from './AppContext';
import Collector from '../collection/Collector';
import {isBot} from '../includes/bot';
import {WidgetTransport} from '../../transport';
import {v4 as uuidv4} from 'uuid';
import {emptyTypingState, normalizeTypingState, insightTypingState} from './typingState';
import {cancelReplyStream, clearMatchingReplyTyping, isCancelledReply, removePartialReply} from './replyStream';
import {closeUnclosedMarkdown} from '../includes/markdown';
import {widgetAppearance} from '../../appearance';

export const ConnectContext = createContext({});
const INSIGHT_POLL_MIN = 2500, INSIGHT_POLL_MAX = 60000;
// While open, a widget whose availability follows who is online asks again this often, and on opening.
const LIVE_AVAILABILITY_MS = 30000;
export function ConnectProvider({children, open, setOpen, setInsightOpen, onSettingsUpdated}) {
  const context = useContext(AppContext);
  const transport = useRef(null);
  const chunks = useRef({});
  const cancelled = useRef(new Set());
  const [collectorReady, setCollectorReady] = useState(false);
  const [monitoring, setMonitoring] = useState(null);
  const shownInsights = useRef(new Set());
  const [contactAuth, setContactAuth] = useState({});
  const [conversationId, setConversationId] = useState(null);
  const [contact, setContact] = useState(context.contact || {});
  const [localContact, setLocalContact] = useState(context.contact || {});
  const [messages, setMessages] = useState([]);
  const [resolution, setResolution] = useState(null);
  const [agentTyping, setAgentTyping] = useState(emptyTypingState);
  const [connectErrors, setConnectErrors] = useState([]);
  const [connectionState, setConnectionState] = useState('connecting');
  const [mainView, setMainView] = useState('conversation');
  const [insight, setInsight] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const [lastConnected, setLastConnected] = useState(0);
  const [conversationSettings, setConversationSettings] = useState({ais: [], human: null, is_human_response_enabled: true, ...context.conversationSettings});
  const configuredAt = useRef(0);
  const fail = useCallback(error => {setConnectionState(navigator.onLine ? 'interrupted' : 'offline');setConnectErrors(current => [...new Set([...current.slice(-4), error.message || String(error)])]);}, []);
  const setFilteredMessages = useCallback(incoming => {
    setMessages(current => {
      const next = [...current];
      for (const item of incoming) {
        const index = next.findIndex(previous => item.id && previous.id === item.id || item.local_id && previous.local_id === item.local_id);
        const previous = index < 0 ? {} : next[index];
        const message = {...item, created_at: item.created_at || previous.created_at || new Date().toISOString()};
        if (previous.uploading_media && !item.uploading_media) message.uploading_media = previous.uploading_media;
        if (previous.chunked && !item.chunked) {message.chunked = true; message.chunked_complete = true;}
        if (previous.sending && !item.sending) message.sending_complete = true;
        if (index < 0) next.push(message); else next[index] = message;
      }
      return next.sort((a,b) => (a.revision ?? Number.MAX_SAFE_INTEGER) - (b.revision ?? Number.MAX_SAFE_INTEGER));
    });
  }, []);
  const processEvent = useCallback(event => {
    const payload = event.payload || event;
    switch (event.type || event.event) {
      case 'configuration': {
        const value = event.configuration;
        configuredAt.current = Date.now();
        setCollectorReady(value.proactiveHelpEnabled === true && !(context.settings.collector.disable_bots && isBot));
        const brand = value.brand?.name || value.project?.name;
        setConversationSettings(current => ({...current, ais: value.ais || [], human: value.currentAgent || (brand ? {id: null, name: `${brand} Team`, initials: brand.split(/\s+/).map(part => part[0]).join('').slice(0,2)} : null), campaignsEnabled:value.campaignsEnabled,campaignsStartAfter:value.campaignsStartAfter,mailMode: value.mailMode, availability: value.availability || null, workspace_brand: {name: brand, avatar_url: value.brand?.avatar_url || value.brand?.logo_url}, is_human_response_enabled: value.is_human_response_enabled, is_contact_tracking_enabled: value.collectorEnabled}));
        onSettingsUpdated?.({...widgetAppearance(value.brand, value.settings), settings: {...value.settings?.settings, collector: {...value.settings?.settings?.collector, enabled: value.collectorEnabled === true}}});
        break;
      }
      case 'session':
        setContactAuth({id: event.session.contactId, token: event.session.token});
        setConversationId(event.session.conversationId);
        setContact(current => ({...current, id: event.session.contactId, ...event.contact}));
        if (event.session.settings) setConversationSettings(current => ({...current, ...event.session.settings}));
        break;
      case 'transcript': setFilteredMessages(event.messages); setResolution(event.resolution || null); break;
      case 'resolution': setResolution(payload.resolution || null); break;
      case 'message':
        setFilteredMessages([event.message || payload]); setThinking(false);
        if (chunks.current[(event.message || payload).local_id]) chunks.current[(event.message || payload).local_id].complete = true;
        setAgentTyping(current => clearMatchingReplyTyping(current, (event.message || payload).local_id));
        break;
      case 'connected': setLastConnected(Date.now()); setConnectionState('connected'); setConnectErrors([]); break;
      case 'disconnected': setConnectionState(navigator.onLine ? 'interrupted' : 'offline'); break;
      case 'typing': if (!isCancelledReply(cancelled.current, payload.local_id)) setAgentTyping(normalizeTypingState(payload)); break;
      case 'chunk': {
        const localId = payload.localId || payload.local_id;
        if (isCancelledReply(cancelled.current, localId)) break;
        const stream = chunks.current[localId] ||= {chunks: [], data: {local_id: localId, chunked: true}};
        if (stream.complete) break;
        if (payload.agent) Object.assign(stream.data, {agent: payload.agent, agent_id: payload.agent.id});
        if (payload.chunk != null && !stream.chunks.some(item => item.index === payload.index)) stream.chunks.push(payload);
        setFilteredMessages([{...stream.data, content: closeUnclosedMarkdown(stream.chunks.sort((a,b) => a.index-b.index).map(item => item.chunk).join(''))}]);
        setThinking(true); break;
      }
      case 'reply_cancelled':
        cancelReplyStream({chunks: chunks.current, cancelledIds: cancelled.current, localId: payload.local_id});
        setMessages(current => removePartialReply(current, payload.local_id));
        setAgentTyping(current => clearMatchingReplyTyping(current, payload.local_id)); setThinking(false); break;
      case 'settings': setConversationSettings(current => ({...current, ...payload})); break;
      case 'insight': setInsight(payload); setInsightOpen(true); break;
      case 'response': setLastResponse(payload); break;
      case 'error': fail(new Error(payload.message || payload.error)); break;
    }
  }, [setFilteredMessages, setInsightOpen, fail, onSettingsUpdated]);
  const eventHandler = useRef(processEvent); eventHandler.current = processEvent;
  // Ask for settings again when the team's availability next changes (it opens or closes) while the widget is open.
  const availabilityChangesAt = conversationSettings.availability?.changesAt;
  useEffect(() => {
    if (!availabilityChangesAt) return;
    const timer = setTimeout(() => { transport.current?.refreshConfiguration().catch(() => {}); }, Math.min(Math.max(availabilityChangesAt - Date.now(), 0) + 1000, 2147483647));
    return () => clearTimeout(timer);
  }, [availabilityChangesAt]);
  // Presence-based away: a teammate can come online or leave at any moment, so an open widget keeps asking.
  const liveAvailability = conversationSettings.availability?.live === true;
  useEffect(() => {
    if (!liveAvailability || !open) return;
    const refresh = () => { transport.current?.refreshConfiguration().catch(() => {}); };
    if (Date.now() - configuredAt.current > LIVE_AVAILABILITY_MS / 2) refresh();
    const timer = setInterval(refresh, LIVE_AVAILABILITY_MS);
    return () => clearInterval(timer);
  }, [liveAvailability, open]);
  useEffect(() => {
    const active = () => transport.current === client && !client.closed;
    const onError = error => { if (active()) fail(error); };
    const client = new WidgetTransport({apiOrigin: context.apiOrigin, widgetKey: context.widgetKey, onEvent: event => { if (active()) eventHandler.current(event); }, onError});
    transport.current = client;
    setMessages([]); setResolution(null); setContactAuth({}); setContact(context.contact || {}); setConversationId(null); setConnectionState('connecting');
    // Installation presence is independent of optional page/activity collection.
    // Send one authenticated ping once the real visitor session is ready.
    client.connect({...localContact, ...context.contact}).then(async () => {
      await client.action('pingActive', {});
      const result = await client.action('contextConsent', {});
      if (active()) setMonitoring(result.monitoring);
    }).catch(onError);
    return () => { client.close(); Collector.setCollectorEnabled(false); Collector.setMessageHandler(null); };
  }, [context.apiOrigin, context.widgetKey, context.contact?.hash, context.contact?.identifier, fail]);
  const assertConnected = useCallback(() => transport.current ? transport.current.connect(localContact) : Promise.reject(new Error('Widget is initializing')), [localContact]);
  const retryConnection = useCallback(async () => {
    const client = transport.current;
    setConnectionState(navigator.onLine ? 'connecting' : 'offline');
    try {
      if (!client) throw new Error('Widget is initializing');
      await client.reconnect(localContact);
    } catch(error) {
      if (transport.current === client && !client?.closed) fail(error);
      throw error;
    }
  }, [localContact, fail]);
  useEffect(() => {
    const offline = () => setConnectionState('offline');
    const online = () => {retryConnection().catch(() => {});};
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => {window.removeEventListener('offline', offline);window.removeEventListener('online', online);};
  }, [retryConnection]);
  const sendMessage = useCallback((action, data) => {
    if (['collector','pingActive'].includes(action) && !context.settings.collector.enabled) return Promise.resolve();
    const client = transport.current;
    if (!client) return Promise.reject(new Error('Widget is initializing'));
    const operation = action === 'sendMessage' ? client.send(data) : client.action(action, data);
    return operation.catch(error => {
      // Background telemetry that hits a server limit is dropped quietly; visitor actions still see the message.
      if (error.rateLimited && action !== 'sendMessage' && !['contact', 'useInsight', 'request'].includes(action)) throw error;
      fail(error);
      if (action === 'sendMessage') setFilteredMessages([{...data, sending: true, failed_send: true}]);
      throw error;
    });
  }, [context.settings.collector.enabled, fail, setFilteredMessages]);
  useEffect(() => {
    Collector.setCollectorEnabled(collectorReady && monitoring?.enabled === true && !open);
    if (collectorReady && monitoring?.enabled === true && !open) Collector.init();
    Collector.setMessageHandler((action, data) => sendMessage(action, data).catch(() => null));
  }, [sendMessage, collectorReady, monitoring?.enabled, open]);
  const setMonitoringConsent = useCallback(async consent => {
    const result = await transport.current.action('contextConsent', {consent});
    setMonitoring(result.monitoring);
    if (!consent) { setInsight(null); setInsightOpen(false); }
  }, [setInsightOpen]);
  // Offers follow analyses: check soon after one is queued, then back off to an idle heartbeat.
  useEffect(() => {
    if (!monitoring?.enabled) return;
    let active = true, timer = null, delay = INSIGHT_POLL_MAX;
    const schedule = next => { clearTimeout(timer); delay = next; timer = setTimeout(poll, delay); };
    const poll = async () => {
      try {
        const result = await transport.current.action('insights', {});
        if (!active) return;
        setMonitoring(result.monitoring);
        if (open) return;
        const next = result.insights?.find(item => !shownInsights.current.has(item.id));
        if (next) { shownInsights.current.add(next.id); setInsight(next); setInsightOpen(true); }
      } catch {}
      if (active) schedule(Math.min(delay * 2, INSIGHT_POLL_MAX));
    };
    const stopListening = Collector.onAnalysisQueued(() => schedule(INSIGHT_POLL_MIN));
    poll();
    return () => { active = false; clearTimeout(timer); stopListening(); };
  }, [monitoring?.enabled, open, setInsightOpen]);
  useEffect(() => {
    setLocalContact(current => JSON.stringify(current) === JSON.stringify(context.contact || {}) ? current : {...current, ...context.contact});
  }, [context.contact]);
  const initialContact = useRef(localContact);
  useEffect(() => {
    if (localContact === initialContact.current) return;
    transport.current?.action('contact', localContact).then(result => setContact({...localContact, ...result.contact, loading_email: false, loading_name: false})).catch(error => { setContact(current => ({...current, loading_email: false, loading_name: false})); fail(error); });
  }, [localContact, fail]);
  const readIds = useRef(new Set());
  useEffect(() => {
    if (!open || !contactAuth.id) return;
    const ids = messages.filter(message => message.id && !message.contact_id && !message.is_read && !readIds.current.has(message.id)).map(message => message.id);
    if (!ids.length) return;
    ids.forEach(id => readIds.current.add(id));
    sendMessage('markAsRead', {ids}).catch(() => ids.forEach(id => readIds.current.delete(id)));
  }, [open, contactAuth.id, messages, sendMessage]);
  const getCurrentAgent = (id = conversationSettings.ai_id) => {
    const ai = conversationSettings.ais.find(agent => agent.id === id);
    return ai ? {...ai, ai, is_ai: true} : conversationSettings.human;
  };
  const sendInsight = (value, button) => {
    if (button.action === 'close') return sendMessage('useInsight', {insight_id: value.id, close: true}).catch(() => {});
    // Stop page collection before opening chat: the opening telemetry must not
    // invalidate the guarded answer requested by this accepted insight.
    Collector.setCollectorEnabled(false);
    const aiLocalId = uuidv4(), contactLocalId = uuidv4();
    return sendMessage('useInsight', {insight_id: value.id, ai_message: {local_id: aiLocalId}, contact_message: {local_id: contactLocalId, content: button.text}}).then(async result => {
      if (result.accepted) { setConversationSettings(current=>({...current,ai_id:result.ai_id})); setInsight(null); if (transport.current.follow(result.conversationId)) setMessages([]); await transport.current.refresh(); }
    }).catch(() => {});
  };
  return <ConnectContext.Provider value={{monitoring, setMonitoringConsent, open, resolution, setResolution, connectionState, retryConnection, assertConnected, contactAuth, setContactAuth, sendMessage, conversationId, setConversationId, setFilteredMessages, mainView, setMainView, messages, setMessages, agentTyping, lastConnected, insight, thinking, sendInsight, conversationSettings, setConversationSettings, localContact, setLocalContact, contact, setContact, connectErrors, getCurrentAgent, lastResponse, uploadMedia: file => transport.current.upload(file)}}>{children}</ConnectContext.Provider>;
}
