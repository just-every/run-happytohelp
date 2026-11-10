import type {Row} from './types'

/** What an imported workspace's widget shows, translated from legacy (README "Legacy widget settings").
 *
 * Legacy stores only the overrides a workspace saved and merges them over its defaults when the widget loads
 * (legacy Project::DEFAULT_WIDGET_SETTINGS, getWidgetSettingsAttribute). The native widget reads the same tree with its
 * own defaults (src/modules/widget/js/context/defaults.js), a few of which differ, and colours its launcher and send
 * button with the workspace's dashboard colour unless the theme sets them (widget/appearance.js). So an import writes
 * the effective legacy tree: legacy's defaults merged under the saved overrides, and the native widget shows legacy's
 * colours and copy whatever its own defaults or the dashboard colour. */

/** Legacy's defaults, less the two branches no widget reads (callouts, settings.header); the email placeholders are
 * native's example address. */
export const LEGACY_WIDGET_DEFAULTS={
 theme:{button:{closed:{background:'#484748',color:'#ffffff'},open:{background:'#f5f6fb',color:'#cecece'}},avatar:{background:'#b2e2ff'},insight:{background:'#ffffff',color:'#333333'},window:{background:'#ffffff',color:'#000000'},chat:{agent:{background:'#f1f9ff',color:'#000000'},user:{background:'#2ca1e5',color:'#ffffff'}},input:{message:{background:'#f5f6fb',color:'#666'},button:{color:'#cecece'},send:{background:'#484748',color:'#ffffff'}}},
 settings:{show_glow:{on_insight:true,on_insight_reply:true,on_ai_typing:false,on_human_typing:false},message:{collect_screenshot:true,collect_attachments:true},collect:{require_name:false,require_email:false}},
 text:{errors:{connection:'Sorry we could not connect to the server. Please check your connection and try again.'},ai:{chat:'AI assisted conversation. Please verify important details.',selection:'Who would you prefer to talk to?',ai:'AI',ai_response:'Responds instantly',human:'Human',human_response:'Responds within 24 hours'},message:{placeholder_message:'Send a message...',placeholder_message_chat:'Message...',placeholder_files:'Drag your files here!',tooltip_contact:'Edit your details',tooltip_screenshot:'Send screenshot',tooltip_attach:'Send file',tooltip_send:'Send message',button_send:'Send',error_name:'Please enter your name',error_email:'Please enter a valid email address',error_message:'Please enter a message to send'},collect:{placeholder_name:'Your Name',placeholder_email:'you@example.com'},prompt:{email_prompt:'Receive an email when {agent_name} replies!',edit_contact:'Edit your contact details below',placeholder_email:'you@example.com',validate_error:'Sorry, that email address does not appear to be valid. Please enter your email address.'},chat:{return_title:'Continue Conversation',return_last_message:'Last message',return_active:'Currently active',sending:'Sending...',sending_image:'Sending image...',sending_images:'Sending images...',sending_file:'Sending file...',sending_files:'Sending files...',failed:'Failed to send',sent:'Sent',received:'Received'}},
}

/** Paths the legacy widget reads and the native widget does not, with when a workspace's value shows a difference.
 * Glows legacy shows on typing or on an insight reply: native shows none, so only an enabled one differs. Native shows
 * its own connection-error copy, and always takes the collector switch from the workspace's tracking setting. Legacy's
 * widget also showed its own footer link (a client default, never a saved setting); native has no footer. */
const legacyOnly:[string,(value:unknown)=>boolean][]=[
 ['settings.show_glow.on_insight_reply',value=>value===true],
 ['settings.show_glow.on_ai_typing',value=>value===true],
 ['settings.show_glow.on_human_typing',value=>value===true],
 ['settings.ai.enabled',()=>true],['settings.ai.types',()=>true],['settings.collector.enabled',()=>true],
 ['text.errors.connection',()=>true],
]
export const LEGACY_FOOTER_PATH='app_logo'

const plain=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)
function merged(base:Row,over:Row):Row{
 const result:Row={...base}
 for(const [key,value] of Object.entries(over))result[key]=plain(value)&&plain(base[key])?merged(base[key] as Row,value):value
 return result
}
const at=(tree:Row,path:string)=>path.split('.').reduce<unknown>((node,key)=>plain(node)?node[key]:undefined,tree)
const parsed=(value:unknown)=>typeof value==='string'?JSON.parse(value):value

/** Theme colours as six-digit hex, the form the dashboard's colour inputs edit (`#666` is `#666666`). */
function sixDigit(node:unknown):unknown{
 if(typeof node==='string')return /^#[0-9a-f]{3}$/i.test(node)?'#'+[...node.slice(1)].map(c=>c+c).join(''):node
 return plain(node)?Object.fromEntries(Object.entries(node).map(([key,value])=>[key,sixDigit(value)])):node
}
/** The effective legacy widget tree for a workspace's saved overrides (null or {} when it saved none). */
export function legacyWidgetSettings(saved:unknown):Row{const tree=merged(LEGACY_WIDGET_DEFAULTS,plain(parsed(saved))?parsed(saved) as Row:{});return {...tree,theme:sixDigit(tree.theme)}}

/** Days 1 (Monday) to 7 (Sunday) as numbers, as native reads and saves them; legacy stores the strings "1"-"7". Times and
 * the away message are kept. */
export function legacySchedule(value:unknown):Row|undefined{
 const schedule=parsed(value)
 if(!plain(schedule))return undefined
 if(!Array.isArray(schedule.days))return schedule
 const days=[...new Set(schedule.days.map(day=>Number(day)).filter(day=>Number.isInteger(day)&&day>=0&&day<=7).map(day=>day===0?7:day))]
 return {...schedule,days}
}

/** The native settings a legacy workspace's widget is imported with: its effective legacy tree, its schedule with
 * numeric days, no presence-based away (legacy had none: with no schedule a team is available whoever is online), and
 * the team shown as the workspace to an unassigned visitor, as legacy showed "<workspace> Team" and its image. */
export function legacyWidgetProjectSettings(project:Row):Row{
 const schedule=legacySchedule(project.availability_schedule)
 return {widget_settings:legacyWidgetSettings(project.widget_settings),...(schedule?{availability_schedule:schedule}:{}),is_presence_away_enabled:false,widget_team_display:'workspace'}
}

/** The dotted legacy paths a workspace's widget relied on that the native widget does not reproduce. */
export function unreproducedWidgetKeys(project:Row):string[]{
 const tree=legacyWidgetSettings(project.widget_settings)
 return [...legacyOnly.filter(([path,differs])=>at(tree,path)!==undefined&&differs(at(tree,path))).map(([path])=>path),LEGACY_FOOTER_PATH]
}
