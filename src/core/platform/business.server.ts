import { createBusinessSettings } from "../../vendor/base/modules/business-settings/index"
import { createOperatorAuth } from "../../vendor/base/modules/operator-auth/index.mjs"
import type { BusinessManifest } from "../../vendor/base/modules/business-settings/types"
import type { Bindings } from './bindings.server'
import { authConfig } from './auth/config.server'
import { operatorMail } from './auth/mail.server.mjs'
import { workspaceStyles } from './business-styles.server'

export const businessManifest: BusinessManifest = {
  settings: 1,
  values: ['display_name', 'owner_name', 'brand_color', 'logo', 'timezone'],
  team: { roles: { admin: 'admin', member: 'member' } },
}

export function businessSettings(bindings: Bindings) {
  const auth = createOperatorAuth({ db: bindings.DB, config: authConfig(bindings), mailSender: operatorMail(bindings), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
  const settings = createBusinessSettings({ db: bindings.DB, trust: bindings.RER_BUSINESS_TRUST, business: businessManifest, team: auth.businessTeam })
  return { ...settings, async handle(request: Request) { return workspaceStyles(request, settings.handle) } }
}
