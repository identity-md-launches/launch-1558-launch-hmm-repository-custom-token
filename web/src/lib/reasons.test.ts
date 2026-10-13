import { describe, expect, it } from 'vitest'
import { pad, stringToHex } from 'viem'
import { bytes32ToAscii, failureKind, humanizeReason, readableCode } from './reasons'

const b32 = (s: string) => pad(stringToHex(s), { size: 32, dir: 'right' })

describe('reason codes', () => {
  it('reads bytes32 ASCII codes', () => {
    expect(bytes32ToAscii(b32('disagreed'))).toBe('disagreed')
    expect(bytes32ToAscii(b32('panel_too_small'))).toBe('panel_too_small')
    expect(bytes32ToAscii(pad('0x0', { size: 32 }))).toBe('')
  })
  it('keeps non-ASCII bytes32 as hex', () => {
    const weird = ('0xff' + '00'.repeat(31)) as `0x${string}`
    expect(bytes32ToAscii(weird)).toBe(weird)
  })
  it('humanizes known codes from hex or text', () => {
    expect(humanizeReason(b32('disagreed')).title).toBe('The panel disagreed')
    expect(humanizeReason('body_refused').title).toBe('The swarm refused the question')
    expect(humanizeReason('expired').code).toBe('expired')
    expect(humanizeReason('ambiguous_question').title).toBe('Ambiguous question')
  })
  it('falls back to a readable form of unknown codes', () => {
    expect(humanizeReason('brand_new_reason').title).toBe('Brand new reason')
    expect(readableCode('x')).toBe('X')
    expect(humanizeReason(pad('0x0', { size: 32 })).title).toBe('No reason given')
  })
  it('maps failure statuses', () => {
    expect(failureKind(1)).toBe('refused')
    expect(failureKind(2)).toBe('unanswered')
    expect(failureKind(3)).toBe('rejected')
    expect(failureKind(7)).toBe('unknown')
  })
})
