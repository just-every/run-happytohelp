/** The cutover checklist uses the same public embed builder as widget settings. */
declare module '*widget-settings/code/anonymousEmbedCode' {
 export function buildAnonymousEmbedCode(config:{widgetKey:string;apiOrigin:string;scriptUrl:string}):string
}
