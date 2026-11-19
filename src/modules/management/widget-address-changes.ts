import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {auditStatement,requestSource,userActor} from '../audit/record'
import type {SettingsGuard} from './settings-save'

type WidgetActor={id:string;projectId:string}
type AddressAction='widget.address_allowed'|'widget.address_removed'|'widget.primary_address_changed'

export function widgetAddressAudit(c:Context<AppEnv>,actor:WidgetActor,action:AddressAction,address:string,guard:SettingsGuard) {
 return auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action,actor:userActor(actor.id),source:requestSource(c),detail:{address}},Date.now(),guard)
}

export function primaryWidgetAddressChange(c:Context<AppEnv>,actor:WidgetActor,address:string,guard:SettingsGuard) {
 const changed={
  sql:`${guard.sql} AND EXISTS(SELECT 1 FROM projects WHERE id=? AND allowed_origin IS NOT ?)`,
  params:[...guard.params,actor.projectId,address],
 }
 return [
  widgetAddressAudit(c,actor,'widget.primary_address_changed',address,changed),
  c.env.DB.prepare(`UPDATE projects SET allowed_origin=? WHERE id=? AND ${changed.sql}`).bind(address,actor.projectId,...changed.params),
 ]
}
