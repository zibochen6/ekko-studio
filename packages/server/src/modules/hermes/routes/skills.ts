import Router from '@koa/router'
import { guardExplicitProfile } from '../controllers/profile-scope'
import * as ctrl from '../controllers/skills'

export const skillRoutes = new Router()

skillRoutes.get('/api/hermes/skills', guardExplicitProfile, ctrl.list)
skillRoutes.get('/api/hermes/skills/usage/stats', guardExplicitProfile, ctrl.usageStats)
skillRoutes.get('/api/hermes/skills/external-dirs', guardExplicitProfile, ctrl.listExternalDirs)
skillRoutes.put('/api/hermes/skills/external-dirs', guardExplicitProfile, ctrl.updateExternalDirs)
skillRoutes.put('/api/hermes/skills/toggle', guardExplicitProfile, ctrl.toggle)
skillRoutes.put('/api/hermes/skills/pin', guardExplicitProfile, ctrl.pin_)
skillRoutes.post('/api/hermes/skills/import', guardExplicitProfile, ctrl.importSkill)
skillRoutes.put('/api/hermes/skills/:category/:skill', guardExplicitProfile, ctrl.updateSkill)
skillRoutes.delete('/api/hermes/skills/:category/:skill', guardExplicitProfile, ctrl.deleteSkill)
skillRoutes.get('/api/hermes/skills/:category/:skill/files', guardExplicitProfile, ctrl.listFiles)
skillRoutes.get('/api/hermes/skills/{*path}', guardExplicitProfile, ctrl.readFile_)
