import React, { Suspense, useCallback, useEffect, useState, useRef, forwardRef, useImperativeHandle } from 'react';
import AppContext from './context/AppContext';
import Connection from './Connection';
import classNames from 'classnames/bind';
import root from 'react-shadow';

import { mergeAdvanced } from "object-merge-advanced";
import Api from "./includes/api";
import PreviewConnectProvider from "./preview/PreviewConnectProvider";
import { ConnectProvider } from "./context/ConnectContext";

import { isPreviewMode, normalizePreviewUpdate } from "./preview/previewMode";
import log from "./includes/log";
import WidgetTooltips from "./WidgetTooltips";
import { initHelpers, openMetaTags, closeMetaTags, updateViewportProperties } from "./includes/utils";

const Button = React.lazy(() => import(/* webpackChunkName: "Button" */ './Button'));
const Insight = React.lazy(() => import(/* webpackChunkName: "Insight" */ './Insight'));
const Interact = React.lazy(() => import(/* webpackChunkName: "Interact" */ './Interact'));
const Style = React.lazy(() => import(/* webpackChunkName: "Style" */ './Style'));

const App = forwardRef(({ config, Collector, onReady }, ref) => {
    const isPreview = isPreviewMode(config);
    const connectionRef = useRef(null);
    const shadowHostRef = useRef(null);
    const previewOpenRef = useRef(false);
    const [open, setOpenState] = useState(false);
    const [insightOpen, setInsightOpenState] = useState(false);
    const [initiated, setInitiated] = useState(false);
    const [ contextValues, setContextValues ] = useState(config);
    const [ settingsLoaded, setSettingsLoaded ] = useState(isPreview || !!config.inlineSettings);

    useEffect(() => {
        previewOpenRef.current = open;
    }, [open]);

    const setPreviewOpen = useCallback((newOpen, notify = false) => {
        const nextOpen = Boolean(newOpen);
        if (previewOpenRef.current === nextOpen) {
            return;
        }

        previewOpenRef.current = nextOpen;
        setOpenState(nextOpen);

        if (notify && typeof config.preview?.onOpenChange === 'function') {
            config.preview.onOpenChange(nextOpen);
        }
    }, [config.preview]);

    // We want the widget to have the smallest possible footprint
    // Initiate runs when it first looks like the app will be interacted with (hover, click etc...)
    // We can then load things like additional fonts needed to run the widget
    const initiate = useCallback(() => {
        if(initiated || !shadowHostRef.current) return;
        if (isPreview) {
            updateViewportProperties(shadowHostRef.current);
        } else {
            initHelpers(shadowHostRef.current);
        }
        setInitiated(true);
    }, [initiated, isPreview]);

    // Exposed methods
    const openWidget = useCallback(() => {
        if (isPreview) {
            setPreviewOpen(true);
            if (!initiated) {
                initiate();
            }
            return;
        }

        setOpenState(true);
        if (!initiated) {
            initiate();
        }
    }, [initiated, initiate, isPreview, setPreviewOpen]);

    const closeWidget = useCallback(() => {
        if (isPreview) {
            setPreviewOpen(false);
            return;
        }

        setOpenState(false);
    }, [isPreview, setPreviewOpen]);

    const updateContext = useCallback((newContext) => {
        const normalizedUpdate = normalizePreviewUpdate(config, newContext);
        if (!normalizedUpdate.allowed) {
            return;
        }

        if (isPreview && typeof normalizedUpdate.update?.preview?.open === 'boolean') {
            setPreviewOpen(normalizedUpdate.update.preview.open);
        }

        setContextValues((currentContext) =>
            mergeAdvanced(currentContext, normalizedUpdate.update, { hardMergeEverything: true })
        );
    }, [config, isPreview, setPreviewOpen]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        open: openWidget,
        close: closeWidget,
        settings: updateContext,
        update: updateContext,
        request: isPreview ? () => Promise.resolve({ preview: true }) : (...args) => connectionRef.current?.request?.(...args),
    }));

    useEffect(() => { onReady?.(); }, [onReady]);

    const fetchSettings = useCallback((configuration) => {
        if (configuration) { setContextValues(current => mergeAdvanced(current, configuration, {hardMergeEverything: true})); return; }
        if (isPreview || config.inlineSettings) {
            return;
        }

        Api.get(`${config.apiUrl}/projects/${ config.projectId }/widget-settings`).then(result => {
            setContextValues(contextValues => {
                const settings = mergeAdvanced(contextValues, result.data, { hardMergeEverything: true });
                localStorage.setItem('happytohelp_widget_settings', JSON.stringify(result.data));
                setSettingsLoaded(true);

                return settings;
            });
        }).catch(error => log.error(error));
    }, [ config, isPreview ]);

    const setOpen = useCallback((newOpen) => {
        if (isPreview) {
            setPreviewOpen(newOpen, true);
            return;
        }

        if(newOpen) setInsightOpenState(false );
        setOpenState(oldOpen => {
            if (oldOpen !== newOpen) {
                Collector.recordAction(newOpen ? 'opened the chat box with you' : 'closed the chat box with you');
                Collector.setWidgetState(newOpen ? 'opened' : 'closed');

                if (newOpen) {
                    openMetaTags();
                    document.body.classList.add('happytohelp-active');
                } else {
                    closeMetaTags();
                    document.body.classList.remove('happytohelp-active');
                }
            }

            return newOpen;
        });
    }, [Collector, isPreview, setPreviewOpen]);

    const setInsightOpen = useCallback((newInsightOpen) => {
        if (isPreview) {
            return false;
        }

        if(newInsightOpen) {
            let currentOpen;
            setOpenState(currentOpen_ => {
                currentOpen = currentOpen_;
                return currentOpen_;  // don't actually change the state
            } );
            if(!currentOpen) {
                Collector.setWidgetState('insight');
                setInsightOpenState(true);
                return true;
            }
        }
        else {
            Collector.setWidgetState('closed');
            setInsightOpenState(false);
        }
        return false;
    }, [isPreview]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSettingsUpdated = (configuration) => {
        fetchSettings(configuration);
    };

    const hoursFromNow = (date) => {
        // To calculate the time difference of two dates
        const diff = Date.now() - Date.parse(date.replace(' ', 'T') + '.000Z');
        return diff / (1000 * 3600);
    }

    useEffect(() => {
        if (isPreview || config.inlineSettings) {
            return;
        }

        const cachedSettings = localStorage.getItem('happytohelp_widget_settings');
        if (cachedSettings) {
            setContextValues(contextValues => mergeAdvanced(contextValues, JSON.parse(cachedSettings), { hardMergeEverything: true }));
            setSettingsLoaded(true);
        } else {
            fetchSettings();
        }
    }, [ config, fetchSettings, isPreview ]);

    // Prepare open state hook
    useEffect(() => {
        if (isPreview) {
            initiate();
            setPreviewOpen(config.preview?.open);
            return;
        }

        const lastMessageAt = localStorage.getItem('happytohelp_last_message_at');

        if (config.inline || config.open) {
            initiate();
            setOpen(true);
        } else if (lastMessageAt && hoursFromNow(lastMessageAt) < 72) {
            // Instantly initiate the widget if the conversation has been updated within 3 days
            initiate();
        }

        // Setup external open listeners
        const clickHandler = (event) => {
            event.preventDefault();
            openWidget();
        };

        let elements = [];
        if(config.selector) {
            try {
                elements = document.querySelectorAll(config.selector);
            }
            catch(err) {
                log.error("init selector is not valid", err);
                elements = [];
            }
            elements.forEach(element => {
                element.addEventListener('click', clickHandler);
            });
        }
        return function cleanup() {
            elements.forEach(element => {
                element.removeEventListener('click', clickHandler);
            });
        };
    }, [initiate, setOpen, setContextValues, config, isPreview, setPreviewOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if((open || insightOpen) && !initiated) {
            // Ensure we initiate if the widget is open
            initiate();
        }
    }, [open, insightOpen, initiate, initiated]);


    const ActiveConnectProvider = isPreview ? PreviewConnectProvider : ConnectProvider;

    return (

            ( settingsLoaded && <root.div ref={shadowHostRef}>
                    <div id="happytohelp-root" className={classNames({
                        'happytohelp-opened': open,
                        'happytohelp-insight-opened': insightOpen,
                        'happytohelp-closed': !open && !insightOpen,
                        'happytohelp-inline': config.inline,
                        'happytohelp-preview': isPreview,
                        'happytohelp-proxy': config.proxy
                    })}>
                        <WidgetTooltips />
                        <AppContext.Provider value={contextValues}>
                            <ActiveConnectProvider open={open} setOpen={setOpen} setInsightOpen={setInsightOpen}
                                                   onSettingsUpdated={handleSettingsUpdated}>
                                {!isPreview && <Connection ref={connectionRef} />}
                                <Suspense fallback={<div/>}>
                                    {initiated ?
                                        <Interact setOpen={setOpen}/>
                                        : null}
                                </Suspense>
                                <Suspense fallback={<div/>}>
                                    {insightOpen ? <Insight insightOpen={insightOpen} setOpen={setOpen}
                                         setInsightOpen={setInsightOpen}/> : null }
                                </Suspense>
                                <Suspense fallback={<div/>}>
                                    { (isPreview || config.settings.button.enabled) ? <Button insightOpen={insightOpen} open={open}
                                    onMouseOver={initiate}
                                    onClick={() => {
                                        if (isPreview || !config.inline) {
                                            initiate();
                                            setOpen(!open);
                                        }
                                    }}/> : null }
                                </Suspense>
                                <Suspense fallback={<div/>}>
                                    {initiated || insightOpen || config.settings.button.enabled ? <Style /> : null }
                                </Suspense>
                                {!config.inline && <div className="happytohelp-bg"/>}
                            </ActiveConnectProvider>
                        </AppContext.Provider>
                    </div>

                </root.div>
            )
    );
});

export default App;
