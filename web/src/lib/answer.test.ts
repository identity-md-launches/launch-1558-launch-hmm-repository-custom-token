import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, getAddress, keccak256, stringToHex } from 'viem'
import { answerLabel, answerText, decodeAnswer } from './answer'

const A = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7'
const H = keccak256(stringToHex('hmm'))

describe('decodeAnswer', () => {
  it('bool (0)', () => {
    const d = decodeAnswer(0, encodeAbiParameters([{ type: 'bool' }], [true]))
    expect(d).toEqual({ type: 'bool', value: true })
    expect(answerLabel(d)).toBe('yes')
    expect(answerLabel(decodeAnswer(0, encodeAbiParameters([{ type: 'bool' }], [false])))).toBe('no')
  })
  it('address (1), checksummed', () => {
    const d = decodeAnswer(1, encodeAbiParameters([{ type: 'address' }], [A]))
    expect(d).toEqual({ type: 'address', value: getAddress(A) })
    expect(answerLabel(d)).toBe('0xD34a…63B7')
  })
  it('bytes32 (2)', () => {
    const d = decodeAnswer(2, encodeAbiParameters([{ type: 'bytes32' }], [H]))
    expect(d).toEqual({ type: 'bytes32', value: H })
  })
  it('uint256 (3)', () => {
    const d = decodeAnswer(3, encodeAbiParameters([{ type: 'uint256' }], [1234567n]))
    expect(d).toEqual({ type: 'uint256', value: 1234567n })
    expect(answerLabel(d)).toBe('1,234,567')
    expect(answerText(d)).toBe('1,234,567')
    const big = decodeAnswer(3, encodeAbiParameters([{ type: 'uint256' }], [2n ** 96n]))
    expect(answerLabel(big)).toBe('7.922e28')
  })
  it('address[] (4)', () => {
    const d = decodeAnswer(4, encodeAbiParameters([{ type: 'address[]' }], [[A, A]]))
    expect(d.type).toBe('address[]')
    expect(answerLabel(d)).toBe('2 addresses')
  })
  it('bytes32[] (5)', () => {
    const d = decodeAnswer(5, encodeAbiParameters([{ type: 'bytes32[]' }], [[H]]))
    expect(d).toEqual({ type: 'bytes32[]', value: [H] })
  })
  it('reports a withheld (hash-only) answer', () => {
    const d = decodeAnswer(4, '0x', H)
    expect(d).toEqual({ type: 'withheld', hash: H, answerType: 4 })
    expect(answerLabel(d)).toBe('long answer (hash only)')
  })
  it('never throws on bad data or unknown types', () => {
    expect(decodeAnswer(9, '0x01').type).toBe('unknown')
    expect(decodeAnswer(3, '0x01').type).toBe('unknown')
    expect(answerLabel(decodeAnswer(9, '0x01'))).toBe('undecodable answer')
  })
})
