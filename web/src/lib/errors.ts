import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, formatUnits } from 'viem'

/**
 * Turns wallet, RPC and contract errors into one plain sentence. Contract errors are decoded with the mine's ABI
 * (custom errors) and OpenZeppelin's ERC-20 errors; anything else falls back to viem's short message.
 */

const imd = (v: unknown) => (typeof v === 'bigint' ? `${formatUnits(v, 18)} IMD` : 'the price')

const MINE_ERRORS: Record<string, (args: readonly unknown[]) => string> = {
  NotLive: () => 'Mining has not started yet: questions open at genesis.',
  BadQuestion: () =>
    'The question must be 1 to 2,000 characters of plain ASCII, without double quotes or backslashes.',
  BadSpec: () =>
    'The question settings are out of range (answer type, chain, window 1-720 h, panel 5-100, quorum at least 4 and a majority).',
  CompleterMustBeEOA: () =>
    'Completing a question others have backed must be sent from a regular wallet account, not a smart-contract wallet. Back a smaller amount, or complete it from a plain wallet.',
  ConfigChanged: () =>
    "This question was proposed under an older oracle setup, so it can't be asked any more. Backers can refund after its 3-day window.",
  NotSold: () => 'The IMD Intake is not selling oracle questions right now (its price is zero).',
  TooSmall: () => 'Back with at least 0.01 IMD, or exactly what is left to raise.',
  NotOpen: () => 'This question is not open for backing any more.',
  FundingClosed: () => "This question's 3-day funding window has closed. Backers can refund.",
  BodyMismatch: () => "The body sent doesn't match the question's. Reload and try again.",
  PriceRose: (a) =>
    `The Intake's price rose to ${imd(a[0])} since this question was proposed at ${imd(a[1])}, so it can't be asked. Backers can refund after the deadline.`,
  OneAskPerTransaction: () => 'Only one question can be asked per transaction.',
  NotRefundable: () => 'Refunds open only for questions that did not raise their price before the deadline.',
  NothingToRefund: () => 'You have nothing to refund on this question.',
  NotAsked: () => 'This question is not waiting for an answer.',
  ERC20InsufficientAllowance: () => 'Approve IMD for the mine first (the allowance is too low).',
  ERC20InsufficientBalance: () => 'Not enough IMD in this wallet.',
}

export function humanizeError(error: unknown): string {
  if (!error) return 'Something went wrong.'
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001)
    if (rejected) return 'You declined the request in your wallet.'

    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    if (revert) {
      const name = revert.data?.errorName
      if (name && MINE_ERRORS[name]) return MINE_ERRORS[name](revert.data?.args ?? [])
      if (name) return `The contract refused: ${name}.`
      const reason = revert.reason ?? ''
      const fromString = fromRevertString(reason)
      if (fromString) return fromString
      if (reason) return `The contract refused: ${reason}`
    }

    const text = `${error.shortMessage} ${error.details ?? ''}`
    const known = fromRevertString(text)
    if (known) return known
    if (/insufficient funds/i.test(text)) return 'Not enough ETH to pay for gas.'
    if (/chain mismatch|does not match the target chain|ChainMismatch/i.test(text))
      return 'Your wallet is on a different network. Switch networks and try again.'
    if (/Connector not connected|ConnectorNotConnected/i.test(text)) return 'Connect a wallet first.'
    if (/already pending|wallet_requestPermissions/i.test(text))
      return 'Your wallet already has a request open. Check the wallet window.'
    if (/HTTP request failed|fetch failed|Failed to fetch|timed? ?out/i.test(text))
      return "The network didn't respond. Check your connection and try again."
    return error.shortMessage || 'Something went wrong.'
  }
  if (error instanceof Error) {
    if (/user rejected|user denied/i.test(error.message)) return 'You declined the request in your wallet.'
    return fromRevertString(error.message) ?? error.message
  }
  return String(error)
}

function fromRevertString(text: string): string | null {
  if (/insufficient allowance/i.test(text)) return 'Approve IMD for the mine first (the allowance is too low).'
  if (/transfer amount exceeds balance|insufficient balance/i.test(text)) return 'Not enough IMD in this wallet.'
  if (/User rejected|User denied|rejected the request/i.test(text)) return 'You declined the request in your wallet.'
  return null
}

/** Is this the user cancelling in their wallet (not worth a red error)? */
export function isUserRejection(error: unknown): boolean {
  if (error instanceof BaseError) {
    return Boolean(error.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001))
  }
  return error instanceof Error && /user rejected|user denied/i.test(error.message)
}
