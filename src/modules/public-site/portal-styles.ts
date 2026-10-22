/** Uses the established help-center frame with focused customer request controls. */
export const portalStyles=`
.help-center-content{max-width:880px;margin-inline:auto}
.help-center-content h1{margin-bottom:1rem}
.help-center-controls{display:flex;gap:1rem;flex-wrap:wrap;align-items:center;padding-bottom:1.5rem;border-bottom:1px solid #dbe5e6;margin-bottom:2rem}
.help-center-controls form{margin:0}
.help-center-controls button,.help-center-signin button,.help-center-feedback button{cursor:pointer;border-radius:.5rem;padding:.7rem 1rem;border:1px solid #14565c;background:#14565c;color:#fff;font:inherit;line-height:1.4}
.help-center-controls button{padding:.35rem .7rem;background:transparent;color:#14565c}
.help-center-signin{display:grid;gap:.65rem;max-width:44rem;margin-block:1.5rem}
.help-center-signin label{font-weight:600}
.help-center-signin input:not([type=checkbox]):not([type=hidden]),.help-center-signin textarea,.help-center-signin select{box-sizing:border-box;width:100%;min-width:0;max-width:100%;border:1px solid #71888b;border-radius:.4rem;padding:.7rem;background:white;color:#18383c;font:inherit;line-height:1.5}
.help-center-signin input[type=checkbox]{width:1.2rem;height:1.2rem;margin-right:.5rem;vertical-align:middle}
.help-center-signin textarea{resize:vertical}
.help-center-signin button{justify-self:start;margin-top:.5rem}
.help-center-feedback{border-top:1px solid #dbe5e6;margin-block:2rem;padding-top:1.5rem}
.help-center-content>ol{list-style:none;padding:0}
.help-center-content>ol>li{padding:1.25rem 0;border-bottom:1px solid #dbe5e6}
.help-center-content article h2{font-size:1rem;margin:0 0 .25rem}
.help-center-content article p{overflow-wrap:anywhere;line-height:1.7}
.help-center-content time{font-size:.9rem;color:#4d666a}
.help-center-content a{overflow-wrap:anywhere}
.help-center-content :focus-visible{outline:3px solid #177b85;outline-offset:3px}
.help-center-content :is(input:not([type=checkbox]):not([type=radio]),select,textarea):focus-visible{outline-offset:-1px}
@media(max-width:600px){.help-center-controls{gap:.8rem}.help-center-signin button{width:100%}.help-center-content{padding-inline:.25rem}}
`
export const portalCSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
export const withPortalStyles=(html:string)=>html.replace('</head>','<link rel="stylesheet" href="/portal/assets/portal.css"></head>')
