import Router from '@koa/router'
import { guardExplicitProfile } from '../controllers/profile-scope'
import * as ctrl from '../controllers/cron-history'

export const cronHistoryRoutes = new Router()

cronHistoryRoutes.get('/api/cron-history', guardExplicitProfile, ctrl.listRuns)
cronHistoryRoutes.get('/api/cron-history/:jobId/:fileName', guardExplicitProfile, ctrl.readRun)
