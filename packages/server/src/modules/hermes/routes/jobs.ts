import Router from '@koa/router'
import { guardExplicitProfile } from '../controllers/profile-scope'
import * as ctrl from '../controllers/jobs'

export const jobRoutes = new Router()

jobRoutes.get('/api/hermes/jobs', guardExplicitProfile, ctrl.list)
jobRoutes.get('/api/hermes/jobs/delivery-targets', guardExplicitProfile, ctrl.deliveryTargets)
jobRoutes.get('/api/hermes/jobs/:id', guardExplicitProfile, ctrl.get)
jobRoutes.post('/api/hermes/jobs', guardExplicitProfile, ctrl.create)
jobRoutes.patch('/api/hermes/jobs/:id', guardExplicitProfile, ctrl.update)
jobRoutes.delete('/api/hermes/jobs/:id', guardExplicitProfile, ctrl.remove)
jobRoutes.post('/api/hermes/jobs/:id/pause', guardExplicitProfile, ctrl.pause)
jobRoutes.post('/api/hermes/jobs/:id/resume', guardExplicitProfile, ctrl.resume)
jobRoutes.post('/api/hermes/jobs/:id/run', guardExplicitProfile, ctrl.run)
