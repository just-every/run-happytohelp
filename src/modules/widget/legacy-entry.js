import {mountWidget, mountPreview} from './index';
import {legacyUpdate, normalizeWidgetOptions, resolveWidgetOptions, scriptOptions} from './legacy-options';
import {clearStoredSessions} from './visitor-identity';

/** One installation and one ordered API, including calls queued before script load. */
export function installWidgetEntry(script) {
  let widget, options, initializing, controller, generation = 0;
  const stop = () => {generation++; controller?.abort(); widget?.destroy(); widget = null; initializing = null;};
  const start = () => {
    const current = generation;
    controller = new AbortController();
    initializing = resolveWidgetOptions(options, controller.signal).then(value => {
      if (current !== generation) throw new Error('Widget initialization was cancelled');
      const mounted = widget = mountWidget(value);
      return mounted.ready.then(() => mounted);
    });
    return initializing;
  };
  const api = (method, value) => {
    const action = String(method || '').toLowerCase();
    if (action === 'preview') {stop(); return widget = mountPreview(value);}
    if (action === 'init') {
      stop(); options = normalizeWidgetOptions(value, script);
      if (alternate) options.settings.button = {enabled:false, ...options.settings.button};
      if (!options.widgetKey && !options.legacyProjectId) throw new Error('A widgetKey or legacy projectId is required');
      return options.settings.await_consent ? Promise.resolve() : start();
    }
    if (action === 'consent') {
      if (typeof value?.provided !== 'boolean') throw new Error('Consent requires a boolean provided value');
      if (!options) throw new Error('Initialize HappyToHelp before using its API');
      options.settings.await_consent = !value.provided;
      if (!value.provided) {stop(); return Promise.resolve();}
      return initializing || start();
    }
    // Sign-out: remove the widget in any state and forget this origin's widget sessions; a later init starts fresh.
    if (action === 'shutdown') {stop(); options = null; clearStoredSessions(); return Promise.resolve();}
    if (!['open','close','update','settings','ask','sales','support','request','destroy'].includes(action)) throw new Error(`Unknown widget action: ${action}`);
    if (action === 'destroy') {stop(); options = null; return;}
    if (!widget && !initializing) {
      if (options?.settings.await_consent && ['open','close'].includes(action)) {options.open = action === 'open'; return Promise.resolve();}
      return Promise.reject(new Error('Initialize HappyToHelp and provide consent before using its API'));
    }
    return Promise.resolve(initializing || widget).then(current => {
      if (action === 'open' || action === 'close') return current[action]();
      if (action === 'settings' || action === 'update') {
        const update = options?.legacyProjectId ? legacyUpdate(value) : value;
        return current.update(update);
      }
      return current.request(['ask','sales','support'].includes(action) ? {...value, method: action} : value);
    });
  };
  const alternate = /(^|\.)hascontext(?:-staging)?\.com$/.test(new URL(script?.src || location.href).hostname) || !!window.hasContextQueue;
  const name = alternate ? 'hasContext' : 'h2h';
  const queue = [...(window[name + 'Queue'] || [])];
  window[name] = api;
  if (!alternate) window.h2h = api;
  const attributes = scriptOptions(script);
  if (attributes && !queue.some(([action]) => String(action).toLowerCase() === 'init')) queue.unshift(['init', attributes]);
  for (const [action, value] of queue) Promise.resolve(api(action, value)).catch(error => {if (error.name !== 'AbortError') console.error('HappyToHelp widget:', error.message);});
  window[name + 'Queue'] = [];
  return api;
}
