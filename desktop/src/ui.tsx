import { version } from '../package.json'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useWindowSize, useGpuixRequired, type StyleDesc } from '@gpuix/react'
import type { Account, AccountService, LoginRequest, Result } from './service'

const light = { bg: '#ffffff', rail: '#fafafa', raised: '#f5f5f5', hover: '#eeeeee', border: '#e5e5e5', text: '#171717', muted: '#666666', primary: '#171717', onPrimary: '#ffffff', danger: '#b42318', focus: '#0070f3' }
const dark = { bg: '#0a0a0a', rail: '#111111', raised: '#191919', hover: '#242424', border: '#2b2b2b', text: '#ededed', muted: '#a1a1a1', primary: '#ededed', onPrimary: '#0a0a0a', danger: '#ff8a80', focus: '#52a8ff' }
type Palette = typeof light
const Theme = createContext<Palette>(dark)
const ControlsEnabled = createContext(true)
const row: StyleDesc = { display: 'flex', flexDirection: 'row', alignItems: 'center' }
const col: StyleDesc = { display: 'flex', flexDirection: 'column', minWidth: 0 }
type IconName = 'accounts' | 'requests' | 'qr' | 'settings' | 'plus' | 'search' | 'copy' | 'eye' | 'hidden' | 'arrow' | 'close' | 'check' | 'lock' | 'trash'
const paths: Record<IconName, string> = {
  accounts: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  requests: '<path d="M5 3h14v14h-4l-3 4-3-4H5z"/><path d="M8 8h8M8 12h5"/>',
  qr: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/><path d="M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M10 5c7-1 12 7 12 7s-1 2-4 4M6 6c-3 2-4 6-4 6s4 7 10 7c2 0 3-1 4-1"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
}
function Icon({ name, color, size = 16 }: { name: IconName; color?: string; size?: number }) {
  const t = useContext(Theme)
  return <svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`} style={{ width: size, height: size, color: color || t.muted, flexShrink: 0 }} />
}
function flattenText(value: ReactNode): string { return Array.isArray(value) ? value.map(flattenText).join('') : value == null || typeof value === 'boolean' ? '' : String(value) }
function Text({ children, size = 14, muted = false, weight = 400, style, testId }: { children: ReactNode; size?: number; muted?: boolean; weight?: number; style?: StyleDesc; testId?: string }) {
  const t = useContext(Theme)
  return <text testId={testId} style={{ fontFamily: 'Geist', fontSize: size, fontWeight: weight, color: muted ? t.muted : t.text, lineHeight: size * 1.5, flexShrink: 0, ...style }}>{flattenText(children)}</text>
}
function Button({ children, onClick, icon, primary = false, quiet = false, danger = false, disabled = false, testId, style }: { children: ReactNode; onClick: () => void; icon?: IconName; primary?: boolean; quiet?: boolean; danger?: boolean; disabled?: boolean; testId?: string; style?: StyleDesc }) {
  const t = useContext(Theme)
  const [focused, setFocused] = useState(false)
  const enabled = useContext(ControlsEnabled)
  disabled = disabled || !enabled
  const color = primary ? t.onPrimary : danger ? t.danger : t.text
  const activate = () => { if (!disabled) onClick() }
  return <div testId={testId} tabIndex={disabled ? -1 : 0} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onClick={activate} onKeyDown={e => { if (e.key === 'enter' || e.key === 'space') activate() }} style={{ ...row, justifyContent: 'center', gap: 8, minHeight: 38, paddingLeft: 12, paddingRight: 12, borderRadius: 6, borderWidth: 1, borderColor: focused ? t.focus : primary ? t.primary : quiet ? 'transparent' : t.border, backgroundColor: primary ? t.primary : 'transparent', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, flexShrink: 0, userSelect: 'none', hover: disabled ? {} : { backgroundColor: primary ? t.muted : t.hover }, ...style }}>
    {icon && <Icon name={icon} color={color} />}<Text weight={500} style={{ color }}>{children}</Text>
  </div>
}
function Field({ label, value, onChange, placeholder, testId, autoFocus = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; testId: string; autoFocus?: boolean }) {
  const t = useContext(Theme)
  const [focused, setFocused] = useState(false)
  const enabled = useContext(ControlsEnabled)
  return <div style={{ ...col, gap: 8 }}>
    <Text weight={500}>{label}</Text>
    <input testId={testId} value={value} readOnly={!enabled} autoFocus={autoFocus} tabIndex={enabled ? 0 : -1} placeholder={placeholder} onChange={e => onChange(e.value || '')} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} theme={{ bg: t.bg, text: t.text, textMuted: t.muted, caret: t.text, accent: t.focus, fontSans: 'Geist' }} style={{ width: '100%', height: 44, paddingLeft: 12, paddingRight: 12, borderWidth: 1, borderColor: focused ? t.focus : t.border, borderRadius: 6, fontFamily: 'Geist', fontSize: 14, color: t.text }} />
  </div>
}
function Divider() { const t = useContext(Theme); return <div style={{ height: 1, backgroundColor: t.border, flexShrink: 0 }} /> }
function Section({ title, children }: { title: string; children?: ReactNode }) { return <div style={{ ...col, gap: 12 }}><Text size={16} weight={500}>{title}</Text>{children}</div> }

type View = 'accounts' | 'requests' | 'qr' | 'settings' | 'add'
type Confirm = { kind: 'remove'; account: Account } | { kind: 'approve'; request: LoginRequest } | { kind: 'qr'; result: Result }
const navigation: { id: View; label: string; icon: IconName }[] = [{ id: 'accounts', label: 'Accounts', icon: 'accounts' }, { id: 'requests', label: 'Requests', icon: 'requests' }, { id: 'qr', label: 'QR sign-in', icon: 'qr' }, { id: 'settings', label: 'Settings', icon: 'settings' }]

export function App({ service }: { service: AccountService }) {
  const renderer = useGpuixRequired()
  const [, redraw] = useState(0)
  useEffect(() => service.subscribe(() => redraw(v => v + 1)), [service])
  const state = service.state
  const { width } = useWindowSize()
  const compact = width < 850
  const t = (process.env.RIOT2FA_THEME || (state?.dark === false ? 'light' : 'dark')) === 'light' ? light : dark
  const [view, setView] = useState<View>('accounts')
  const [search, setSearch] = useState('')
  const [reveal, setReveal] = useState(process.argv.includes('--demo'))
  const [copied, setCopied] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [qrAccount, setQrAccount] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  useEffect(() => {
    const snapshot = state?.snapshot
    if (!snapshot) return
    setView('qr'); setConfirm(null)
    setQrUrl(snapshot.url || ''); setError(snapshot.error || '')
    setNotice(snapshot.url ? 'QR code captured' : '')
    renderer.activateWindow?.()
  }, [state?.snapshot?.id, renderer])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer) }, [notice])
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 2200); return () => clearTimeout(timer) }, [copied])
  const navigate = (next: View) => { setView(next); setError(''); setConfirm(null); setSecret('') }
  const run = async (method: string, params: Record<string, unknown> = {}, done?: (result: Result) => void) => {
    if (busy) return
    setBusy(method); setError(''); setNotice('')
    try { const result = await service.call(method, params); if (result.message) setNotice(result.message); done?.(result) }
    catch (e) { setError(e instanceof Error ? e.message : 'The action failed. Try again.') }
    finally { setBusy('') }
  }
  const accounts = state?.accounts || []
  const requests = state?.requests || []
  const filtered = accounts.filter(a => a.name.toLowerCase().includes(search.toLowerCase().trim()))
  const visibleError = service.error || state?.error || error
  const heading = view === 'add' ? 'Add an account' : view === 'qr' ? 'Sign in with QR' : navigation.find(n => n.id === view)?.label || 'Accounts'
  const unavailable = Boolean(service.error || state?.error || !state)
  const nav = <div style={{ ...col, ...(compact ? { flexDirection: 'row', gap: 4 } : { gap: 4, width: '100%' }) }}>{navigation.map(item => <Button key={item.id} testId={`nav-${item.id}`} icon={item.icon} quiet onClick={() => navigate(item.id)} style={{ justifyContent: 'flex-start', backgroundColor: view === item.id || item.id === 'accounts' && view === 'add' ? t.hover : 'transparent', ...(compact ? { flexGrow: 1 } : {}) }}>{item.label}{item.id === 'requests' && requests.length > 0 ? `  ${requests.length}` : ''}</Button>)}</div>

  const empty = (title: string, detail: string, action?: ReactNode) => <div style={{ ...col, alignItems: 'flex-start', justifyContent: 'center', paddingTop: 56, paddingBottom: 56, gap: 12 }}><Text size={24} weight={500}>{title}</Text><Text muted style={{ maxWidth: 440 }}>{detail}</Text>{action && <div style={{ marginTop: 12 }}>{action}</div>}</div>
  const doConfirm = () => {
    if (!confirm) return
    if (confirm.kind === 'remove') void run('remove', { accountId: confirm.account.id }, () => setConfirm(null))
    if (confirm.kind === 'approve') void run('respond', { requestId: confirm.request.id, approve: true }, () => setConfirm(null))
    if (confirm.kind === 'qr') void run('qr_approve', { confirmation: confirm.result.confirmation }, () => { setConfirm(null); setQrUrl('') })
  }

  return <Theme.Provider value={t}><ControlsEnabled.Provider value={!confirm}><div testId="app" style={{ ...col, width: '100%', height: '100%', backgroundColor: t.bg, selectionColor: t.focus + '40' }}>
    <div style={{ ...row, height: 68, paddingLeft: compact ? 24 : 28, paddingRight: 28, borderBottomWidth: 1, borderColor: t.border, flexShrink: 0, justifyContent: 'space-between' }}>
      <div style={{ ...row, gap: 12 }}><Icon name="lock" color={t.text} size={22} /><Text size={18} weight={600}>Riot 2FA</Text></div>
      {state?.demo && <Text size={12} muted>Demo</Text>}
    </div>
    {compact && <div style={{ padding: 12, borderBottomWidth: 1, borderColor: t.border }}>{nav}</div>}
    <div style={{ ...row, alignItems: 'stretch', flexGrow: 1, minHeight: 0 }}>
      {!compact && <div style={{ ...col, width: 208, padding: 16, paddingTop: 24, borderRightWidth: 1, borderColor: t.border, backgroundColor: t.rail, flexShrink: 0, justifyContent: 'space-between' }}>
        {nav}
      </div>}
      <div testId="main-scroll" style={{ ...col, flexGrow: 1, minHeight: 0, overflowY: 'scroll', padding: compact ? 24 : 40, gap: 28 }}>
        <div style={{ ...col, gap: 24 }}>
          <div style={{ ...row, justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ ...col, gap: 6, flexGrow: 1 }}><Text size={32} weight={600}>{heading}</Text></div>
            {view === 'accounts' && <Button primary icon="plus" testId="add-account" onClick={() => navigate('add')}>Add account</Button>}
          </div>
        </div>
        {visibleError && <div testId="error" style={{ ...col, padding: 16, borderWidth: 1, borderColor: t.danger, borderRadius: 6, gap: 6 }}><Text weight={500} style={{ color: t.danger }}>Could not complete the action</Text><Text style={{ color: t.danger }}>{visibleError}</Text></div>}
        {notice && <div testId="notice" style={{ ...row, gap: 10, padding: 12, backgroundColor: t.raised, borderRadius: 6 }}><Icon name="check" color={t.text} /><Text>{notice}</Text></div>}

        {view === 'accounts' && <div style={{ ...col, gap: 24 }}>
          <div style={{ ...row, gap: 12 }}><div style={{ ...col, flexGrow: 1 }}><Field label="Find an account" value={search} onChange={setSearch} placeholder="Search by Riot ID" testId="search" /></div><div style={{ alignSelf: 'flex-end' }}><Button quiet icon={reveal ? 'hidden' : 'eye'} testId="toggle-codes" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide codes' : 'Show codes'}</Button></div></div>
          <div style={{ ...col, gap: 0 }}>
            <div style={{ ...row, justifyContent: 'space-between', paddingBottom: 12 }}><Text size={12} muted>{filtered.length} {filtered.length === 1 ? 'account' : 'accounts'}{search ? ` of ${accounts.length}` : ''}</Text><Text testId="countdown" size={12} muted>Refreshes in {state?.remaining ?? 30}s</Text></div>
            <div style={{ height: 2, backgroundColor: t.border }}><div style={{ height: 2, width: `${(state?.remaining ?? 30) / 30 * 100}%`, backgroundColor: t.muted }} /></div>
            {!state && !service.error ? empty('Opening your accounts', 'Loading accounts stored on this device.') : accounts.length === 0 ? empty('Your first account starts here', 'Connect your Riot account to keep its sign-in codes on this device.', <Button primary onClick={() => navigate('add')} icon="plus">Add an account</Button>) : filtered.length === 0 ? empty('No matching accounts', 'Try another Riot ID, or clear your search.', <Button testId="clear-search" onClick={() => setSearch('')}>Clear search</Button>) : filtered.map(a => <div key={a.id} testId={`account-${a.id}`} style={{ ...col, paddingTop: 24, paddingBottom: 24, gap: 16, borderBottomWidth: 1, borderColor: t.border }}>
              <div style={{ ...row, gap: 20, justifyContent: 'space-between', ...(compact ? { flexDirection: 'column', alignItems: 'stretch', gap: 16 } : {}) }}>
                <div style={{ ...col, gap: 4, flexGrow: 1 }}><Text size={16} weight={500}>{a.name}</Text></div>
                <div style={{ ...row, gap: 12, justifyContent: 'space-between' }}>
                  <Text testId={`code-${a.id}`} size={32} weight={500} style={{ width: 146, whiteSpace: 'nowrap', userSelect: 'none' }}>{!a.code ? 'Invalid' : reveal ? `${a.code.slice(0, 3)} ${a.code.slice(3)}` : '••• •••'}</Text>
                  <Button testId={`copy-${a.id}`} icon={copied === a.id ? 'check' : 'copy'} disabled={Boolean(busy) || unavailable || !a.code} onClick={() => void run('copy', { accountId: a.id }, () => setCopied(a.id))}>{copied === a.id ? 'Copied' : 'Copy'}</Button>
                  <Button testId={`remove-${a.id}`} quiet icon="trash" onClick={() => { setError(''); setConfirm({ kind: 'remove', account: a }) }}>Remove</Button>
                </div>
              </div>
            </div>)}
          </div>
        </div>}

        {view === 'add' && <div style={{ ...col, maxWidth: 600, gap: 28 }}>
          <Section title="Connect with Riot"><Text muted>Requires email two-factor authentication.</Text><div style={{ ...row, gap: 12 }}><Button primary icon="arrow" testId="browser-login" disabled={Boolean(busy) || unavailable} onClick={() => void run('login', {}, () => navigate('accounts'))}>{busy === 'login' ? 'Waiting for browser…' : 'Continue with Riot'}</Button>{busy === 'login' && <Button onClick={() => { void service.call('cancel_login').catch(() => {}) }}>Cancel login</Button>}</div></Section>
          <Divider />
          <Section title="Or add an existing secret"></Section>
          <Field label="Account name" value={name} onChange={setName} placeholder="YourName#EUW" testId="account-name" />
          <Field label="Account secret or setup URL" value={secret} onChange={setSecret} placeholder="Paste your Base32 secret" testId="account-secret" />
          <Text size={12} muted>Secret entry is visible. Stored unencrypted on this device.</Text>
          <div style={{ ...row, gap: 12 }}><Button primary testId="save-account" disabled={Boolean(busy) || unavailable || !name.trim() || !secret.trim()} onClick={() => void run('add', { name, secret }, () => { setName(''); setSecret(''); navigate('accounts') })}>{busy === 'add' ? 'Adding…' : 'Add account'}</Button><Button quiet onClick={() => navigate('accounts')}>Cancel</Button></div>
        </div>}

        {view === 'requests' && <div style={{ ...col, gap: 24 }}>
          <div style={{ ...row, justifyContent: 'space-between' }}><Text size={12} muted>{requests.length} pending</Text><Text size={12} muted>{state?.pushStatus || 'Connecting'}</Text></div><Divider />
          {requests.length === 0 ? empty('No sign-ins waiting', 'New sign-in requests appear here while the app is open. Only approve requests you started.') : requests.map(request => <div key={request.id} style={{ ...col, gap: 20, paddingBottom: 24, borderBottomWidth: 1, borderColor: t.border }}>
            <div style={{ ...col, gap: 6 }}><Text size={24} weight={500}>{request.name}</Text></div>
            <div style={{ ...col, gap: 8 }}><Text>Location: {request.location}</Text><Text muted>Requested: {formatTime(request.time)}</Text></div>
            <div style={{ ...row, gap: 12 }}><Button primary testId={`approve-${request.id}`} disabled={Boolean(busy) || unavailable} onClick={() => { setError(''); setConfirm({ kind: 'approve', request }) }}>Review approval</Button><Button testId={`deny-${request.id}`} disabled={Boolean(busy) || unavailable} onClick={() => void run('respond', { requestId: request.id, approve: false })}>Deny sign-in</Button></div>
          </div>)}
        </div>}

        {view === 'qr' && <div style={{ ...col, gap: 24, maxWidth: 600 }}>
          <Section title="Account to sign in">{accounts.filter(a => a.qrEnabled).length === 0 ? <Text muted>Add an account through browser login to use QR sign-in.</Text> : accounts.filter(a => a.qrEnabled).map(a => <Button key={a.id} testId={`qr-account-${a.id}`} icon={qrAccount === a.id ? 'check' : 'accounts'} onClick={() => { setQrAccount(a.id); setConfirm(null) }} style={{ justifyContent: 'flex-start', backgroundColor: qrAccount === a.id ? t.raised : 'transparent', borderColor: qrAccount === a.id ? t.text : t.border }}>{a.name}</Button>)}</Section>
          <Divider /><Section title="SnapShots"><div style={{ ...row }}><Button icon="qr" testId="scan-screen" disabled={Boolean(busy) || unavailable} onClick={() => void run('scan', {}, result => { if (result.url) setQrUrl(result.url) })}>{busy === 'scan' ? 'Select a region…' : 'Capture region'}</Button>{busy === 'scan' && process.platform === 'win32' && <Button onClick={() => { void service.call('cancel_scan') }}>Cancel capture</Button>}</div></Section>
          <Field label="Riot QR sign-in URL" value={qrUrl} onChange={value => { setQrUrl(value); setConfirm(null) }} placeholder="Paste the URL from your QR code" testId="qr-url" />
          <div style={{ ...row }}><Button primary disabled={Boolean(busy) || unavailable || !qrAccount || !qrUrl.trim()} testId="review-qr" onClick={() => void run('qr_prepare', { accountId: qrAccount, url: qrUrl }, result => setConfirm({ kind: 'qr', result }))}>{busy === 'qr_prepare' ? 'Loading request…' : 'Review sign-in'}</Button></div>
        </div>}

        {view === 'settings' && <div style={{ ...col, gap: 28, maxWidth: 620 }}>
          {process.platform === 'win32' && <><Section title="SnapShots"><div style={{ ...row, gap: 16, justifyContent: 'space-between' }}><Text>Both Shift keys · Active window</Text><Button testId="toggle-snapshots" disabled={Boolean(busy)} onClick={() => void run('snapshots', { enabled: !state?.snapshotsEnabled })}>{state?.snapshotsEnabled ? 'Disable shortcut' : 'Enable shortcut'}</Button></div><Text size={12} muted>{state?.snapshotStatus}</Text></Section><Divider /></>}

          <Section title="Account storage"><Text muted>Your accounts stay in a local JSON file. Account secrets and browser sessions are not encrypted by this app.</Text><Text size={12} style={{ fontFamily: process.platform === 'win32' ? 'Consolas' : 'monospace' }}>{state?.storagePath || 'Loading path…'}</Text></Section><Divider />
          <Section title="Privacy"><Text muted>Codes are hidden on launch. While the app is open, copied codes clear from the clipboard after 30 seconds, unless you have copied something else.</Text><Text muted>Removing an account here does not disable two-factor authentication on Riot.</Text></Section><Divider />
          <Section title="Appearance"><Text muted>Follows your system appearance. Native window controls follow your operating system.</Text></Section><Divider />
          <Section title="Sign-in requests"><Text muted>{state?.pushStatus || 'Connecting'}. Keep this window open or minimized to receive requests. Closing the window quits the app.</Text></Section><Divider />
          <Section title="About"><Text>Riot 2FA · {version}</Text><Text muted>An independent desktop client. Not affiliated with Riot Games or Vercel.</Text><Text size={12} muted>This edition does not install updates automatically. The check below reports releases of this desktop app.</Text><div style={{ ...row }}><Button testId="check-update" disabled={Boolean(busy) || unavailable} onClick={() => void run('check_update')}>{busy === 'check_update' ? 'Checking…' : 'Check for updates'}</Button></div></Section>
        </div>}
      </div>
    </div>
    <div style={{ ...row, justifyContent: 'space-between', height: 36, paddingLeft: 24, paddingRight: 24, borderTopWidth: 1, borderColor: t.border, flexShrink: 0 }}><Text size={12} muted>{state?.pushStatus || 'Opening your accounts'}</Text></div>
    {confirm && <ControlsEnabled.Provider value={true}><div testId="confirmation-overlay" style={{ ...col, position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center', padding: 24, pointerEvents: 'auto' }}>
      <div testId="confirmation" tabIndex={0} autoFocus onKeyDown={e => { if (e.key === 'escape' && !busy) setConfirm(null) }} style={{ ...col, width: '100%', maxWidth: 460, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 8, padding: 28, gap: 20 }}>
        <Text size={24} weight={600}>{confirm.kind === 'remove' ? 'Remove this account?' : 'Approve this sign-in?'}</Text>
        <Text size={16} weight={500}>{confirm.kind === 'remove' ? confirm.account.name : confirm.kind === 'approve' ? confirm.request.name : confirm.result.name}</Text>
        <Text muted>{confirm.kind === 'remove' ? 'This removes the saved secret and session from this device. It does not disable two-factor authentication on Riot. Make sure you have another way to sign in.' : `Location: ${confirm.kind === 'approve' ? confirm.request.location : confirm.result.location}. Only continue if you started this sign-in.`}</Text>
        {error && <Text style={{ color: t.danger }}>{error}</Text>}
        <div style={{ ...row, justifyContent: 'flex-end', gap: 12 }}><Button testId="cancel-confirm" disabled={Boolean(busy)} onClick={() => { setConfirm(null); setError('') }}>Cancel</Button><Button testId="confirm-action" primary disabled={Boolean(busy)} onClick={doConfirm}>{busy ? 'Working…' : confirm.kind === 'remove' ? 'Remove account' : 'Approve sign-in'}</Button></div>
      </div>
    </div></ControlsEnabled.Provider>}
  </div></ControlsEnabled.Provider></Theme.Provider>
}

function formatTime(value: LoginRequest['time']) {
  if (!value) return 'Time unavailable'
  const date = new Date(Number(value))
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
