import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/ui'
import { AccountService } from '../src/service'
if (!hasNativeTestRenderer) throw new Error('The renderer must include native accessibility test support')
const service = new AccountService(true, undefined, false)
const root = createTestRoot({ width: 1080, height: 760 })
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
try {
  root.render(<App service={service} />)
  const nodes = () => Object.values(root.renderer.getA11yTree().nodes || {}).map(n => n.aria).filter(Boolean) as any[]
  assert(nodes().some(n => n.role === 'Button' && n.label === 'Add account'), 'Add button is absent from the native accessibility tree')
  assert(nodes().some(n => n.label === 'Find an account'), 'Search field has no accessible name')
  assert(nodes().some(n => n.role === 'Heading'), 'No native headings')
  assert(!JSON.stringify(nodes()).includes('JBSWY3DPEHPK3PXP'), 'Native accessibility tree exposed a saved secret')
  const add = root.renderer.findByTestId('add-account')!
  root.renderer.nativeSimulateKeystrokes(add.id, 'enter')
  root.renderer.flush()
  assert(nodes().some(n => n.label === 'Account secret or setup URL'), 'Secret field has no accessible name')
  console.log('Native accessibility tree exposes named actions, headings and fields without saved secrets')
} finally { service.close(); root.unmount() }
