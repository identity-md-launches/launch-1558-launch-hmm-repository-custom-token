import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_BYTES,
  SIMD_VAULT,
  bodyFits,
  buildBody,
  byteLength,
  checkField,
  fillTemplate,
  parseBody,
  templates,
  toRawUnits,
} from './body'
import { keccak256, stringToHex, toBytes } from 'viem'

const IMD = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7'
const tpl = (id: string) => templates().find((t) => t.id === id)!

describe('buildBody', () => {
  it('builds the exact bool body (same bytes as the contract tests use)', () => {
    const q = 'Did IMD trade on Uniswap v4 today?'
    expect(buildBody(q, 'bool')).toBe(
      '{"v":1,"question":"Did IMD trade on Uniswap v4 today?","chainId":1,"window":{"hours":24},"answerType":"bool","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400}',
    )
  })

  it('adds toleranceBps 0 for uint256 answers, last', () => {
    expect(buildBody('How many?', 'uint256')).toBe(
      '{"v":1,"question":"How many?","chainId":1,"window":{"hours":24},"answerType":"uint256","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400,"toleranceBps":0}',
    )
  })

  it('round-trips through chain hex', () => {
    const json = buildBody('Was it?', 'bool')
    const { body } = parseBody(stringToHex(json))
    expect(body?.question).toBe('Was it?')
    expect(body?.answerType).toBe('bool')
    expect(keccak256(toBytes(json))).toBe(keccak256(stringToHex(json)))
  })

  it('parseBody tolerates non-JSON bodies', () => {
    expect(parseBody(stringToHex('not json')).body).toBeNull()
    expect(parseBody('[1,2]').body).toBeNull()
  })
})

describe('byte limits', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('é')).toBe(2)
    expect(byteLength('🐸')).toBe(4)
  })

  it('accepts exactly 16,384 bytes and refuses one more', () => {
    const skeleton = buildBody('', 'bool')
    const room = MAX_BODY_BYTES - byteLength(skeleton)
    const fits = buildBody('a'.repeat(room), 'bool')
    expect(byteLength(fits)).toBe(MAX_BODY_BYTES)
    expect(bodyFits(fits)).toBe(true)
    const over = buildBody('a'.repeat(room + 1), 'bool')
    expect(byteLength(over)).toBe(MAX_BODY_BYTES + 1)
    expect(bodyFits(over)).toBe(false)
    // multi-byte characters count by bytes
    const frogs = buildBody('🐸'.repeat(Math.floor(room / 4) + 1), 'bool')
    expect(bodyFits(frogs)).toBe(false)
    expect(bodyFits('')).toBe(false)
  })
})

describe('vetted templates', () => {
  it('log count (uint256)', () => {
    const r = fillTemplate(tpl('log-count'), { event: 'Transfer(address,address,uint256)', address: IMD.toLowerCase() })
    expect(r.errors).toEqual({})
    expect(r.question).toBe(
      "How many Transfer(address,address,uint256) logs did the contract 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7 emit on Ethereum mainnet from the window's first block through its last block, inclusive?",
    )
    expect(buildBody(r.question!, tpl('log-count').answerType)).toBe(
      `{"v":1,"question":"How many Transfer(address,address,uint256) logs did the contract 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7 emit on Ethereum mainnet from the window's first block through its last block, inclusive?","chainId":1,"window":{"hours":24},"answerType":"uint256","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400,"toleranceBps":0}`,
    )
  })

  it('log threshold (bool)', () => {
    const r = fillTemplate(tpl('log-threshold'), { address: IMD, n: '0100', event: 'Transfer(address, address, uint256)' })
    expect(r.question).toBe(
      "From the window's first block through its last block on Ethereum mainnet, did the contract 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7 emit more than 100 Transfer(address,address,uint256) logs?",
    )
    expect(tpl('log-threshold').answerType).toBe('bool')
  })

  it('token balance threshold (bool)', () => {
    const r = fillTemplate(tpl('balance-threshold'), {
      holder: '0x9efa934d9fad4ae28c998a40195646b965a97247',
      token: IMD,
      raw: '1000000000000000000000',
    })
    expect(r.question).toBe(
      `At the window's closing block, was balanceOf(${SIMD_VAULT}) on the ERC-20 contract 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7 on Ethereum mainnet greater than 1000000000000000000000 (raw units)?`,
    )
  })

  it('supply threshold (bool) gives the exact vetted body', () => {
    const r = fillTemplate(tpl('supply-threshold'), { token: IMD, decimals: '18', raw: '1000000000000000000' })
    expect(buildBody(r.question!, 'bool')).toBe(
      `{"v":1,"question":"At the window's closing block, was totalSupply() of the ERC-20 contract 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7 on Ethereum mainnet greater than 1000000000000000000 (raw units, 18 decimals)?","chainId":1,"window":{"hours":24},"answerType":"bool","evidence":"chain","panelSize":5,"quorum":4,"validForSeconds":86400}`,
    )
  })

  it('ETH balance threshold (bool)', () => {
    const r = fillTemplate(tpl('eth-balance'), { address: SIMD_VAULT, wei: '1000000000000000000' })
    expect(r.question).toBe(
      `At the window's closing block, was the native ETH balance of address ${SIMD_VAULT} on Ethereum mainnet greater than 1000000000000000000 wei?`,
    )
  })

  it('pool price (uint256)', () => {
    const id = '0x415829F72E9F54531C26EAE76F107618540E898A45D6AE35959E143F5FACA704'
    const r = fillTemplate(tpl('pool-price'), { poolId: id })
    expect(r.question).toBe(
      "What was sqrtPriceX96 of Uniswap v4 pool 0x415829f72e9f54531c26eae76f107618540e898a45d6ae35959e143f5faca704 in the Ethereum mainnet PoolManager 0x000000000004444c5dc75cb358380d2e3de08a90 at the window's closing block?",
    )
    expect(tpl('pool-price').answerType).toBe('uint256')
  })

  it('reports field errors and returns no question', () => {
    const r = fillTemplate(tpl('eth-balance'), { address: '0x123', wei: '-5' })
    expect(r.question).toBeNull()
    expect(Object.keys(r.errors).sort()).toEqual(['address', 'wei'])
  })
})

describe('checkField', () => {
  it('checksums addresses and rejects bad checksums', () => {
    expect(checkField('address', IMD.toLowerCase())).toEqual({ ok: true, value: IMD })
    expect(checkField('address', '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263b7').ok).toBe(false)
    expect(checkField('address', '0x0000000000000000000000000000000000000000').ok).toBe(false)
    expect(checkField('address', 'hello').ok).toBe(false)
  })
  it('normalizes integers and bounds them to uint256', () => {
    expect(checkField('uint', '007')).toEqual({ ok: true, value: '7' })
    expect(checkField('uint', '1.5').ok).toBe(false)
    expect(checkField('uint', (2n ** 256n).toString()).ok).toBe(false)
    expect(checkField('uint', (2n ** 256n - 1n).toString()).ok).toBe(true)
  })
  it('accepts canonical event signatures only', () => {
    expect(checkField('event', 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)').ok).toBe(true)
    expect(checkField('event', 'Transfer(address indexed from)').ok).toBe(false)
    expect(checkField('event', 'transfer').ok).toBe(false)
    expect(checkField('event', 'Transfer(address, address, uint256)')).toEqual({ ok: true, value: 'Transfer(address,address,uint256)' })
    expect(checkField('event', 'Ping()').ok).toBe(true)
    expect(checkField('event', 'X(uint7)').ok).toBe(false)
    expect(checkField('event', 'X(bytes33)').ok).toBe(false)
    expect(checkField('event', 'X(uint256[],bytes32[2])').ok).toBe(true)
  })
  it('bytes32 ids are lowercased', () => {
    expect(checkField('bytes32', '0x' + 'AB'.repeat(32))).toEqual({ ok: true, value: '0x' + 'ab'.repeat(32) })
    expect(checkField('bytes32', '0x1234').ok).toBe(false)
  })
})

describe('toRawUnits', () => {
  it('converts whole units exactly', () => {
    expect(toRawUnits('1', 18)).toBe('1000000000000000000')
    expect(toRawUnits('1.5', 6)).toBe('1500000')
    expect(toRawUnits('0.000000000000000001', 18)).toBe('1')
    expect(toRawUnits('1.0000001', 6)).toBeNull()
    expect(toRawUnits('abc', 18)).toBeNull()
  })
})
