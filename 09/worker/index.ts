import { handleApi, type Env } from './api'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
