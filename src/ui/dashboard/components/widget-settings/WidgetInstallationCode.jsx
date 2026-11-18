import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { WidgetSettingsContext } from '../../contexts/WidgetSettingsContext';
import CodeSnippet from './CodeSnippet';
import SecretControl from './SecretControl';
import { buildAnonymousEmbedCode } from './code/anonymousEmbedCode';
import { buildAiIntegrationBrief } from './code/aiIntegrationBrief';
import {
    buildMetadataExample,
    buildVerificationExample,
    VERIFICATION_LANGUAGES,
} from './code/verificationExamples';

const HIGHLIGHT_LANGUAGES = {
    php: 'php',
    node: 'javascript',
    python: 'python',
    ruby: 'ruby',
    go: 'go',
    csharp: 'csharp',
};

export default function WidgetInstallationCode({website}) {
    const { installation } = useContext(WidgetSettingsContext);
    const [language, setLanguage] = useState(VERIFICATION_LANGUAGES[0].id);
    const languageButtons = useRef({});
    const anonymousCode = useMemo(() => buildAnonymousEmbedCode(installation), [installation]);
    const verificationCode = useMemo(
        () => buildVerificationExample(installation, language),
        [installation, language],
    );
    const metadataCode = useMemo(
        () => buildMetadataExample(installation, language),
        [installation, language],
    );
    const aiIntegrationBrief = useMemo(
        () => buildAiIntegrationBrief(installation, language),
        [installation, language],
    );
    const selectedLanguage = VERIFICATION_LANGUAGES.find(item => item.id === language);

    const selectLanguage = useCallback(languageId => {
        setLanguage(languageId);
    }, []);

    const handleLanguageKeyDown = useCallback((event, languageId) => {
        const currentIndex = VERIFICATION_LANGUAGES.findIndex(item => item.id === languageId);
        let nextIndex = null;

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % VERIFICATION_LANGUAGES.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + VERIFICATION_LANGUAGES.length) % VERIFICATION_LANGUAGES.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = VERIFICATION_LANGUAGES.length - 1;
        }

        if (nextIndex === null) return;

        event.preventDefault();
        const nextLanguage = VERIFICATION_LANGUAGES[nextIndex].id;
        selectLanguage(nextLanguage);
        window.requestAnimationFrame(() => languageButtons.current[nextLanguage]?.focus());
    }, [selectLanguage]);

    return (
        <div className="widget-code">
            <section className="widget-code__section" aria-labelledby="widget-code-install-heading">
                <div className="widget-code__section-heading">
                    <h2 id="widget-code-install-heading"><span aria-hidden="true">2.</span> Add this code to every page</h2>
                    <p>Add this script to every page where you want the widget to appear.</p>
                </div>
                <CodeSnippet
                    disabled={!website}
                    unavailable="Enter your website address first, so the chat works on your site"
                    code={anonymousCode}
                    language="html"
                    copyLabel="Copy"
                    copyAriaLabel="Copy anonymous installation code"
                    aiCode={aiIntegrationBrief}
                    aiCopyAriaLabel="Copy redacted AI setup guide from the anonymous installation snippet"
                />
                {website && <a className="btn btn-white mt-3" href={`mailto:?subject=${encodeURIComponent("Install our support chat")}&body=${encodeURIComponent(`Our website address: ${website}\n\nAdd this code to every page on that website:\n\n${anonymousCode}`)}`}>Send to my developer</a>}
            </section>

            <details className="widget-code__advanced">
                <summary>Details for your developer</summary>
            <p>The saved website address uses the scheme, hostname and optional port, without a path, query or fragment.</p>
            <section className="widget-code__section widget-code__section--secret" aria-labelledby="widget-code-secret-heading">
                <div className="widget-code__section-heading">
                    <h2 id="widget-code-secret-heading">Server secret</h2>
                    <p>Use this secret to verify signed-in users on your server.</p>
                </div>
                <SecretControl />
            </section>

            <section className="widget-code__section" aria-labelledby="widget-code-verification-heading">
                <div className="widget-code__section-heading">
                    <h2 id="widget-code-verification-heading"><span aria-hidden="true">2.</span> Verify signed-in users (server-side)</h2>
                    <p>Sign the current user’s identifier on your server, then pass the verified contact to the widget.</p>
                </div>
                <div className="widget-code__languages" role="tablist" aria-label="Verification example language">
                    {VERIFICATION_LANGUAGES.map(item => (
                        <button
                            key={item.id}
                            ref={element => { languageButtons.current[item.id] = element; }}
                            type="button"
                            role="tab"
                            id={`widget-code-language-${item.id}`}
                            aria-selected={language === item.id}
                            aria-controls="widget-code-verification-example"
                            tabIndex={language === item.id ? 0 : -1}
                            className={language === item.id ? 'is-active' : ''}
                            onClick={() => selectLanguage(item.id)}
                            onKeyDown={event => handleLanguageKeyDown(event, item.id)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <div
                    id="widget-code-verification-example"
                    className="widget-code__verification-example"
                    role="tabpanel"
                    aria-labelledby={`widget-code-language-${language}`}
                >
                    <CodeSnippet
                        disabled={!website}
                        unavailable="Enter your website address first, so the chat works on your site"
                        code={verificationCode}
                        language={HIGHLIGHT_LANGUAGES[language]}
                        copyLabel="Copy"
                        copyAriaLabel={`Copy ${selectedLanguage.label} verification example`}
                        aiCode={aiIntegrationBrief}
                        aiCopyAriaLabel={`Copy redacted AI setup guide with the ${selectedLanguage.label} verification example`}
                    />
                </div>
            </section>

            <details className="widget-code__metadata">
                <summary>Optional: sign metadata</summary>
                <div className="widget-code__metadata-content">
                    <p>You can include additional user or account metadata in the payload. Optional metadata includes its own verification hash.</p>
                    <p>Append the {selectedLanguage.label} metadata code after the identity example to create its verification hash.</p>
                    <CodeSnippet
                        disabled={!website}
                        unavailable="Enter your website address first, so the chat works on your site"
                        code={metadataCode}
                        language={HIGHLIGHT_LANGUAGES[language]}
                        copyLabel="Copy metadata addition"
                        copyAriaLabel={`Copy ${selectedLanguage.label} metadata addition`}
                        aiCode={aiIntegrationBrief}
                        aiCopyAriaLabel={`Copy redacted AI setup guide with the ${selectedLanguage.label} metadata addition`}
                    />
                </div>
            </details>
            </details>
        </div>
    );
}
