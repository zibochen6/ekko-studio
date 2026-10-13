import Router from '@koa/router'
import { guardExplicitProfile } from '../controllers/profile-scope'
import * as ctrl from '../controllers/skill-bundles'

export const skillBundleRoutes = new Router()

skillBundleRoutes.get('/api/hermes/bundles', guardExplicitProfile, ctrl.list)
skillBundleRoutes.post('/api/hermes/bundles', guardExplicitProfile, ctrl.create)
skillBundleRoutes.delete('/api/hermes/bundles/:commandName', guardExplicitProfile, ctrl.remove)
