import { getRequest } from '@tanstack/react-start/server'
import type { Bindings } from '../bindings.server'
import { sessionForRequest } from './session.server'

export function sessionForStartRequest(bindings: Bindings) {
  return sessionForRequest(bindings, getRequest())
}
