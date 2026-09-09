import { expect, test } from 'bun:test'
import { request } from './riot'

test('a sign-in redirect is reported as a session error without forwarding credentials', async () => {
  let followed = false
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req) {
    if (new URL(req.url).pathname === '/log-in') { followed = true; return new Response('login') }
    return new Response(null, { status: 302, headers: { Location: '/log-in?private=session' } })
  } })
  try {
    await expect(request(server.url.href, { headers: { Cookie: 'ssid=synthetic-test' } })).rejects.toThrow('Sign in again')
    expect(followed).toBe(false)
  } finally { server.stop(true) }
})
