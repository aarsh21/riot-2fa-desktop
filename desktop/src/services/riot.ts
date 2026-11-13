import { totp } from './totp'

const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const authenticatorAgent = 'RiotGamesApi/26.3.0.0 rso-authenticator (Android;12.31;SKQ1.211019.001 test-keys;) ritoplus/5.3.0'
export class ServiceError extends Error {
  constructor(message: string, readonly kind: 'session' | 'network' | 'request' = 'request', readonly status?: number) { super(message) }
}
export async function request(url: string, options: RequestInit = {}) {
  let response: Response
  try { response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000) }) }
  catch (error) {
    const host = new URL(url).hostname
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ServiceError(`The request to ${host} timed out. Try again.`, 'network')
    throw new ServiceError(`Could not connect to ${host}. Check your connection and try again.`, 'network')
  }
  if (response.status >= 300 && response.status < 400) throw new ServiceError('The service redirected this request instead of accepting the session. Sign in again through the browser.', 'session', response.status)
  if (!response.ok) {
    if (response.status === 401) throw new ServiceError('Your session expired. Reconnect this account through the browser.', 'session', response.status)
    if (response.status === 403) throw new ServiceError('Riot refused access to this action. Try reconnecting this account.', 'request', response.status)
    if ([400, 404, 409, 410].includes(response.status)) throw new ServiceError('This request is invalid, expired or already handled. Start a new sign-in and try again.', 'request', response.status)
    throw new ServiceError(`The service returned HTTP ${response.status}. Try again later.`, 'network', response.status)
  }
  return response
}
async function json(url: string, options: RequestInit = {}): Promise<any> {
  const response = await request(url, options)
  const text = await response.text()
  return text ? JSON.parse(text) : {}
}
export function cookieHeader(cookies: Record<string, string>) {
  // Cookie names use HTTP's token grammar. Riot also issues authenticator.sid;
  // dropping dotted names silently turns a valid login session into a 400.
  return Object.entries(cookies).filter(([k, v]) => /^[!#$%&'*+.^_`|~\w-]+$/.test(k) && /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(v)).map(([k, v]) => `${k}=${v}`).join('; ')
}
function accountHeaders(cookies: Record<string, string>, csrf: string) { return { 'accept': 'application/json', 'content-type': 'application/json', 'csrf-token': csrf, 'origin': 'https://account.riotgames.com', 'referer': 'https://account.riotgames.com/', 'user-agent': agent, 'cookie': cookieHeader(cookies) } }
export async function csrfToken(cookies: Record<string, string>) {
  const response = await request('https://account.riotgames.com/', { headers: { cookie: cookieHeader(cookies), 'user-agent': agent } })
  const html = await response.text()
  const tag = html.match(/<meta\b[^>]*\bname=["']csrf-token["'][^>]*>/i)?.[0]
  const token = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1]
  if (!token) throw new ServiceError('Could not read the account session. Close the browser and sign in again.')
  return token
}
export const fetchUser = (cookies: Record<string, string>, csrf: string) => json('https://account.riotgames.com/api/account/v1/user', { headers: accountHeaders(cookies, csrf) })
export const fetchFactors = (cookies: Record<string, string>, csrf: string) => json('https://account.riotgames.com/api/mfa/v2/factors', { headers: accountHeaders(cookies, csrf) })
export async function enableMfa(cookies: Record<string, string>, csrf: string): Promise<string> {
  const result = await json('https://account.riotgames.com/api/mfa/v2/factors/riotmobile/enable', { method: 'POST', headers: accountHeaders(cookies, csrf) })
  if (typeof result.secret !== 'string') throw new ServiceError('Riot did not return an account secret.')
  return result.secret
}
export function userName(user: any): string { const alias = user.alias; return alias?.game_name ? alias.game_name + (alias.tag_line ? `#${alias.tag_line}` : '') : user.username || user.sub || 'Unknown' }
export function tokenValid(token?: string): boolean {
  try { const payload = JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString()); return typeof payload.exp === 'number' && payload.exp > Date.now() / 1000 + 15 } catch { return false }
}
export const SSO_COOKIE_NAMES = ['ssid', 'clid', 'csid', 'tdid', 'sub', 'ccid', 'asid']
export type TokenSession = { token: string | null; cookies: Record<string, string> }
export async function mintToken(cookies: Record<string, string> = {}): Promise<TokenSession> {
  if (!cookies.ssid) return { token: null, cookies }
  const response = await request('https://auth.riotgames.com/api/v1/authorization', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': agent, cookie: cookieHeader(cookies) }, body: JSON.stringify({ client_id: 'ritoplus', nonce: '1', redirect_uri: 'http://localhost/redirect', response_type: 'token id_token', scope: 'openid account link ban lol summoner offline_access riot://riot.authenticator/session.auth' }) })
  // RSO can rotate its session cookie on authorization. Persist the replacement
  // with the token so the next launch does not reuse a retired session.
  const renewed = { ...cookies }
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0]!, index = pair.indexOf('=')
    const name = pair.slice(0, index), value = pair.slice(index + 1)
    if (index < 1 || !SSO_COOKIE_NAMES.includes(name)) continue
    if (!value || /;\s*max-age=0(?:;|$)/i.test(header)) delete renewed[name]
    else renewed[name] = value
  }
  const result = await response.json() as any
  if (result.type === 'auth' || result.type === 'multifactor') return { token: null, cookies: renewed }
  if (result.type !== 'response' || typeof result.response?.parameters?.uri !== 'string') throw new ServiceError('Riot returned an unreadable session. Try again.', 'network')
  let url: URL
  try { url = new URL(result.response.parameters.uri) } catch { throw new ServiceError('Riot returned an unreadable session. Try again.', 'network') }
  const token = new URLSearchParams(url.hash.slice(1)).get('access_token') || url.searchParams.get('access_token')
  if (!tokenValid(token || undefined)) throw new ServiceError('Riot did not return a usable access token. Try again.', 'network')
  return { token, cookies: renewed }
}
const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': authenticatorAgent })
export async function verifyMfa(token: string, seed: string) {
  const result = await json('https://api.account.riotgames.com/mfa/v1/factor/riotmobile/verify', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ device: 'Redmi Note 12 Pro', otp: totp(seed) }) })
  if (result.success === false || result.error || result.status === 'error') throw new ServiceError('Riot did not accept this code.', 'request', 400)
}
export async function registerPush(token: string, fcmToken: string) { await json('https://riot-geo.mps.si.riotgames.com/mps/v1/app/riotmobile-mfa/device', { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ device_token: fcmToken, platform: 'android', locale: 'en-US' }) }) }
export function parseQr(value: string): { suuid: string; cluster: string } {
  let suuid: string | null = null, cluster: string | null = null
  try {
    if (/^https?:\/\//i.test(value.trim())) { const u = new URL(value.trim()); suuid = u.searchParams.get('suuid'); cluster = u.searchParams.get('cluster') }
    else { const i = value.indexOf(':'); if (i > 0) { suuid = value.slice(0, i).trim(); cluster = value.slice(i + 1).trim() } }
  } catch { /* A malformed URL fails the same validation below. */ }
  if (!suuid || !cluster || !/^[a-zA-Z0-9_-]{8,128}$/.test(suuid) || !/^[a-zA-Z0-9_-]{1,40}$/.test(cluster)) throw new ServiceError('This is not a valid Riot sign-in QR URL.')
  return { suuid, cluster }
}
export const qrInfo = (token: string, suuid: string, cluster: string) => json(`https://authenticate.riotgames.com/api/v1/session/info?${new URLSearchParams({ suuid, cluster })}`, { headers: authHeaders(token) })
export const approveQr = (token: string, suuid: string, cluster: string) => json('https://authenticate.riotgames.com/api/v1/session/authentication', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ suuid, cluster, remember: true }) })
export async function respondToMfa(raw: Record<string, unknown>, seed: string, approve: boolean) {
  await json('https://authenticate.riotgames.com/api/v1/session/totp-verification', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ suuid: raw.suuid, cluster: raw.cluster, puuid: raw.puuid, totp: totp(seed), action: approve ? 'approve' : 'deny', known_value: null }) })
}
