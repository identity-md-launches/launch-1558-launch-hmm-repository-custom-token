import { describe, expect, it } from 'vitest'
import { badQuestionChars, minQuorum, specBody, specError, specFor, toAsciiQuestion } from './spec'
import { buildBody, byteLength, fillTemplate, templates } from './body'

const IMD = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7'

describe('specBody (mirrors the mine’s bodyOf)', () => {
  it('composes the bool body exactly', () => {
    expect(specBody(specFor('Did IMD trade on Uniswap v4 today?', 'bool'))).toBe(
      '{"v":1,"question":"Did IMD trade on Uniswap v4 today?","chainId":1,"window":{"hours":24},"answerType":"bool","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400}',
    )
  })
  it('adds toleranceBps for uint256 only, last', () => {
    expect(specBody(specFor('How many?', 'uint256', { toleranceBps: 25 }))).toBe(
      '{"v":1,"question":"How many?","chainId":1,"window":{"hours":24},"answerType":"uint256","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400,"toleranceBps":25}',
    )
  })
  it('carries every spec field', () => {
    expect(
      specBody(specFor('Is it?', 'address', { chainId: 8453, windowHours: 72, evidence: 1, panelSize: 9, quorum: 6 })),
    ).toBe(
      '{"v":1,"question":"Is it?","chainId":8453,"window":{"hours":72},"answerType":"address","evidence":"panel","panelSize":9,"quorum":6,"validForSeconds":86400}',
    )
  })
  it('equals JSON.stringify for every vetted template (no escaping needed)', () => {
    for (const t of templates()) {
      const values: Record<string, string> = {}
      for (const f of t.fields) values[f.key] = f.initial ?? (f.kind === 'address' ? IMD : f.kind === 'uint' ? '1000' : '18')
      const { question } = fillTemplate(t, values)
      expect(question).not.toBeNull()
      expect(badQuestionChars(question!)).toEqual([])
      const spec = specFor(question!, t.answerType as 'bool' | 'uint256')
      expect(specError(spec)).toBeNull()
      expect(specBody(spec)).toBe(buildBody(question!, t.answerType))
      expect(JSON.parse(specBody(spec)).question).toBe(question)
    }
  })
})

describe('the mine’s rules', () => {
  const ok = specFor('Was it more than 5?', 'bool')
  it('accepts the template defaults', () => expect(specError(ok)).toBeNull())
  it('refuses empty, too long and non-printable questions', () => {
    expect(specError({ ...ok, question: '' })).toMatch(/Write/)
    expect(specError({ ...ok, question: 'a'.repeat(2000) })).toBeNull()
    expect(specError({ ...ok, question: 'a'.repeat(2001) })).toMatch(/2,000/)
    expect(specError({ ...ok, question: 'say "hi"' })).toMatch(/ASCII/)
    expect(specError({ ...ok, question: 'back\\slash' })).toMatch(/ASCII/)
    expect(specError({ ...ok, question: 'line\nbreak' })).toMatch(/ASCII/)
    expect(specError({ ...ok, question: 'café' })).toMatch(/ASCII/)
  })
  it('limits answer types, evidence and chains', () => {
    expect(specError({ ...ok, answerType: 4 })).toMatch(/answer type/)
    expect(specError({ ...ok, evidence: 2 })).toMatch(/evidence/)
    expect(specError({ ...ok, chainId: 10 })).toMatch(/chain/)
    for (const id of [1, 56, 4663, 8453, 42161]) expect(specError({ ...ok, chainId: id })).toBeNull()
  })
  it('bounds the window, panel and quorum', () => {
    expect(specError({ ...ok, windowHours: 0 })).toMatch(/Window/)
    expect(specError({ ...ok, windowHours: 721 })).toMatch(/Window/)
    expect(specError({ ...ok, panelSize: 4, quorum: 4 })).toMatch(/Panel/)
    expect(specError({ ...ok, panelSize: 101, quorum: 60 })).toMatch(/Panel/)
    expect(specError({ ...ok, quorum: 3 })).toMatch(/Quorum/)
    expect(specError({ ...ok, quorum: 6 })).toMatch(/Quorum/)
    expect(specError({ ...ok, panelSize: 8, quorum: 4 })).toMatch(/Quorum/)
    expect(specError({ ...ok, panelSize: 8, quorum: 5 })).toBeNull()
    expect(minQuorum(5)).toBe(4)
    expect(minQuorum(8)).toBe(5)
    expect(minQuorum(100)).toBe(51)
  })
  it('allows tolerance on uint256 only', () => {
    expect(specError({ ...ok, toleranceBps: 10 })).toMatch(/number answers/)
    const n = specFor('How many?', 'uint256')
    expect(specError({ ...n, toleranceBps: 10_000 })).toBeNull()
    expect(specError({ ...n, toleranceBps: 10_001 })).toMatch(/Tolerance/)
  })
})

describe('toAsciiQuestion', () => {
  it('rewrites typographic characters into accepted ASCII', () => {
    const q = toAsciiQuestion('At the window’s close — was “supply” > 5…\nreally?')
    expect(q).toBe("At the window's close - was 'supply' > 5... really?")
    expect(badQuestionChars(q)).toEqual([])
    expect(byteLength(q)).toBe(q.length)
  })
  it('drops double quotes and backslashes', () => {
    expect(toAsciiQuestion('a "b" c\\d')).toBe("a 'b' c/d")
  })
})
