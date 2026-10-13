import type { Context, Next } from 'koa'
import { ProfileLifecycleError } from '../services/profiles/lifecycle'
import { withExplicitProfileDirectory } from '../services/profiles/request-scope'

/** Global user/profile authorization runs before these scoped routes. */
export async function guardExplicitProfile(ctx: Context, next: Next): Promise<void> {
  const profile = ctx.state.profile?.name
  if (!profile) {
    await next()
    return
  }
  try {
    await withExplicitProfileDirectory(profile, next)
  } catch (error) {
    if (!(error instanceof ProfileLifecycleError)) throw error
    ctx.status = error.status
    ctx.body = { error: error.message, code: error.code }
  }
}
