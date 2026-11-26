// Token Radar, model radar-2: snapshot in, ranked board out.
//
// Board rule: rank EVERY protocol that passes the watchlist's own test
// (records no token, and is not a wrapped, staked or bridged product of a
// token that already trades), not just the biggest few by TVL. The 40
// watchlist protocols are the floor; the early rows are the rest that pass
// the same test below the floor. Live-token protocols are kept apart and
// shown with their market cap, never mixed into the ranking.
//
// Implied value uses only the snapshot's own figures, the same function
// for every row, no protocol name ever special-cased:
//
//   base     = tvl_usd x 0.22
//   growth   = clamp(change_7d, -50, 150) per cent
//   growthM  = 1 + (growth / 100) x 0.6
//   maturity = 0.70 + 0.30 x min(age_days, 1460) / 1460
//              (age = days from listed_at to as_of; unknown age = 365)
//   breadth  = 1 + 0.03 x min(chains - 1, 5)
//   implied  = max(1, round(base x growthM x maturity x breadth))
//
// Why each factor: TVL is the size of the launch if a token ever captures
// a share of the value locked; 7-day growth is momentum, clamped so one
// wild week cannot dominate; age with no token is how long the protocol
// has run un-tokenised, so an older one is more overdue; chain breadth is
// how widely the protocol is already distributed. The dashboard and the
// dossier state this formula in full, and the page recomputes every row
// from the same figures, so code and board visibly agree.
//
// Farm plans: every category has its own set of action templates, at
// least four per category, written for what that kind of protocol
// actually does. A row's plan picks four of its category's templates,
// rotated by the protocol's slug so two protocols in one category do
// not get the same four steps in the same order, then adds the shared
// wallet, second-chain, hold, claim-check and log steps. Every step is
// a suggested onchain action with a concrete cost and time, never a
// guaranteed airdrop: the snapshot carries no airdrop flag, and no step
// claims one, a token, a price, a yield or a date the snapshot does
// not carry.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
};

export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name are that exchange's product. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol may be ranked: pre-token, and it passes the
 * watchlist's own wrapped/staked test. This is the same test the house
 * used to build the watchlist, applied to every row, so a protocol below
 * the floor is judged by the same rule as one on it.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: every rankable protocol, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  // The watchlist is the floor: every slug on it, even one the snapshot
  // no longer carries (it cannot, but coverage is never gambled).
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol that passes the same test.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: action, then cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// ---------------------------------------------------------------------------
// Farm plan templates, one set per category. Placeholders: {name} is the
// protocol name, {chain} its first chain, {capital} the position size,
// {half} half of it, {hold} the hold in days. Every set has at least
// four templates, each a concrete onchain action for that kind of
// protocol. No template promises an airdrop, a token, a price, a yield
// or a date.
// ---------------------------------------------------------------------------

const FARM_TEMPLATES: Record<string, string[]> = {
  'Risk Curators': [
    'Deposit ${capital} into a {name} vault on {chain} and keep the vault shares.',
    'Deposit ${half} into a second {name} vault on {chain} with a different risk profile.',
    'Move ${half} between two {name} vaults on {chain} after comparing their published allocations.',
    'Add ${half} to your {name} vault position on {chain} and leave it in the vault.',
  ],
  Dexs: [
    'Provide ${capital} of liquidity to the main {name} pool on {chain} and keep the position open.',
    'Swap ${half} of USDC for the other asset in the pool through {name} on {chain}.',
    'Add ${half} of liquidity to a second {name} pool on {chain}.',
    'Provide ${half} of single-sided liquidity to {name} on {chain} if the pool supports it.',
  ],
  'Onchain Capital Allocator': [
    'Deposit ${capital} into a {name} allocation vault on {chain} and keep the shares.',
    'Allocate ${half} to a second {name} strategy on {chain}.',
    'Move ${half} between {name} strategies on {chain} after reading the latest strategy report.',
    'Top up your {name} allocation on {chain} by ${half} and hold the position.',
  ],
  RWA: [
    'Mint ${capital} of the yield-bearing asset through {name} on {chain} and hold it.',
    'Buy ${half} of a tokenised asset through {name} on {chain} on the secondary market.',
    'Mint ${half} more of the {name} yield asset on {chain} after checking its redemption terms.',
    'Hold ${half} of the {name} asset in a second position on {chain} as a separate tranche.',
  ],
  Lending: [
    'Supply ${capital} of USDC to {name} on {chain} and keep the supply position open.',
    'Borrow ${half} of USDC against your supplied collateral on {name} and repay it within the same week.',
    'Supply ${half} of a second asset to {name} on {chain} alongside your USDC.',
    'Repay ${half} of an open {name} borrow on {chain} and check the position health factor.',
  ],
  Yield: [
    'Deposit ${capital} into a {name} yield vault on {chain} and keep the shares.',
    'Stake ${half} in a second {name} vault on {chain}.',
    'Compound ${half} of accrued rewards back into your {name} position on {chain}.',
    'Move ${half} between two {name} vaults on {chain} after comparing their published strategies.',
  ],
  Derivatives: [
    'Deposit ${capital} of USDC as margin on {name} and open one small hedge.',
    'Open a second small hedge on {name} with ${half} of margin.',
    'Close ${half} of an open {name} position and keep the rest running.',
    'Deposit ${half} more margin on {name} to widen the buffer on your open position.',
  ],
  CDP: [
    'Lock ${capital} of collateral in {name} on {chain} and mint stablecoins against it.',
    'Repay ${half} of your {name} debt on {chain} and check the collateral ratio.',
    'Add ${half} of collateral to your {name} position on {chain}.',
    'Mint ${half} of stablecoins from a second {name} collateral type on {chain}.',
  ],
  'Yield Aggregator': [
    'Deposit ${capital} into a {name} aggregator vault on {chain} and keep the shares.',
    'Switch ${half} of your {name} deposit to a different strategy in the same vault.',
    'Deposit ${half} into a second {name} vault on {chain}.',
    'Compound ${half} back into your {name} vault on {chain} instead of withdrawing it.',
  ],
  'Basis Trading': [
    'Deposit ${capital} into a {name} basis vault on {chain} and keep the shares.',
    'Add ${half} to your {name} basis position on {chain} after checking the funding rate.',
    'Deposit ${half} into a second {name} basis strategy on {chain}.',
    'Withdraw ${half} from your {name} position on {chain} as a test and redeposit it.',
  ],
  Chain: [
    'Bridge ${capital} of USDC to {chain} through the chain own bridge and use it in a native app.',
    'Stake ${half} of the chain native asset on {chain} through a validator.',
    'Swap ${half} on a native {chain} dex and hold the received asset.',
    'Vote on one {chain} governance proposal with ${half} of voting power if you hold it.',
  ],
  'Staking Pool': [
    'Stake ${capital} of the chain staking asset in the {name} pool on {chain} and keep the receipt.',
    'Delegate ${half} to a second validator through {name} on {chain}.',
    'Restake ${half} of accrued staking rewards through {name} on {chain}.',
    'Unstake ${half} as a test from {name} on {chain} and restake it.',
  ],
  'Liquidity Manager': [
    'Deposit ${capital} into a {name} managed liquidity position on {chain}.',
    'Rebalance ${half} of your {name} range on {chain} after a price move.',
    'Add ${half} to a second {name} managed range on {chain}.',
    'Withdraw ${half} from your {name} position on {chain} and redeposit it in a narrower range.',
  ],
  'Prediction Market': [
    'Fund ${capital} and place one market position on {name}.',
    'Place a second ${half} position on a different {name} market.',
    'Trade out of ${half} of an open {name} position before it resolves.',
    'Add ${half} to an open {name} market position you already hold.',
  ],
  Restaking: [
    'Restake ${capital} of the staking receipt through {name} and keep the new receipt.',
    'Delegate ${half} of your restaked position to a second operator through {name}.',
    'Restake ${half} more of the staking asset through {name} on {chain}.',
    'Unstake ${half} from {name} as a test and restake it with a different operator.',
  ],
  'Stablecoin Wrapper': [
    'Wrap ${capital} of the stablecoin through {name} on {chain} and hold the wrapped asset.',
    'Use ${half} of the wrapped asset in a {name} pool on {chain}.',
    'Unwrap ${half} through {name} on {chain} as a test and wrap it again.',
    'Wrap ${half} more of the stablecoin through {name} on {chain}.',
  ],
  CeDeFi: [
    'Deposit ${capital} into {name} on {chain} and keep the position open.',
    'Check the published proof of reserves for {name}, then deposit ${half} more on {chain}.',
    'Withdraw ${half} from {name} on {chain} as a test and redeposit it.',
    'Move ${half} between two {name} products on {chain}.',
  ],
  Farm: [
    'Deposit ${capital} of LP tokens into the {name} farm on {chain}.',
    'Harvest ${half} of accrued farm rewards on {name} and compound them back in.',
    'Deposit ${half} of LP tokens into a second {name} farm pool on {chain}.',
    'Stake ${half} of the farm receipt token in the {name} staking pool on {chain}.',
  ],
  'Anchor BTC': [
    'Mint ${capital} of the BTC-anchored asset through {name} on {chain} and hold it.',
    'Use ${half} of the anchored asset as collateral on {name} on {chain}.',
    'Redeem ${half} of the anchored asset through {name} on {chain} as a test and mint it again.',
    'Hold ${half} of the anchored asset in a {name} vault on {chain}.',
  ],
  'Leveraged Farming': [
    'Open a small leveraged farm position on {name} with ${capital} of collateral on {chain}.',
    'Add ${half} of collateral to your {name} leveraged position on {chain}.',
    'Reduce ${half} of your {name} leveraged position on {chain} after a price move.',
    'Close ${half} of the {name} position on {chain} and keep the rest running.',
  ],
  'Dual-Token Stablecoin': [
    'Mint ${capital} of the stablecoin through {name} on {chain} against collateral.',
    'Stake ${half} of the protocol second token through {name} on {chain}.',
    'Mint ${half} more of the stablecoin through {name} on {chain} from a second collateral type.',
    'Repay ${half} of your {name} stablecoin debt on {chain} and check the peg.',
  ],
  'Decentralized BTC': [
    'Mint ${capital} of the BTC-backed asset through {name} on {chain} and hold it.',
    'Deposit ${half} of the BTC-backed asset into a {name} vault on {chain}.',
    'Use ${half} of the BTC-backed asset as collateral on {name} on {chain}.',
    'Redeem ${half} of the BTC-backed asset through {name} on {chain} as a test.',
  ],
  'Collateral Markets': [
    'Supply ${capital} of collateral to a {name} market on {chain}.',
    'Borrow ${half} against your {name} collateral on {chain} and repay it within the week.',
    'Supply ${half} of a second collateral type to {name} on {chain}.',
    'Repay ${half} of an open {name} borrow on {chain} and check the market health factor.',
  ],
  'CDP Manager': [
    'Open a {name} vault with ${capital} of collateral on {chain} and mint stablecoins.',
    'Adjust your {name} vault by adding ${half} of collateral on {chain}.',
    'Repay ${half} of your {name} vault debt on {chain}.',
    'Open a second {name} vault with ${half} of a different collateral type on {chain}.',
  ],
  Payments: [
    'Send ${capital} through {name} on {chain} and keep the receipt.',
    'Receive ${half} through {name} on {chain} into your farming wallet.',
    'Pay one invoice of ${half} through {name} on {chain}.',
    'Send ${half} through {name} on {chain} to a second wallet you control as a test.',
  ],
  'OTC Marketplace': [
    'Place a small OTC order of ${capital} through {name} on {chain}.',
    'Settle a ${half} OTC trade through {name} on {chain} and keep the receipt.',
    'List ${half} for an OTC sale through {name} on {chain}.',
    'Buy ${half} through a {name} OTC order on {chain} and check settlement.',
  ],
  'Cross Chain Bridge': [
    'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app.',
    'Bridge ${half} back through {name} as a test and bridge it out again.',
    'Bridge ${half} of USDC to a second chain through {name}.',
    'Use ${half} of bridged funds in a {name}-supported app on {chain}.',
  ],
  'Governance Incentives': [
    'Vote on one {name} proposal with ${half} of voting power on {chain}.',
    'Delegate ${half} of your voting power through {name} on {chain}.',
    'Claim incentives from {name} on {chain} only through the link its own page publishes.',
    'Vote on a second {name} proposal on {chain} after reading the discussion.',
  ],
  Insurance: [
    'Buy ${capital} of cover from {name} on {chain} and keep the policy.',
    'Buy ${half} of cover for a second protocol from {name} on {chain}.',
    'Top up your {name} cover on {chain} by ${half}.',
    'Check your {name} policy terms on {chain} and extend the cover by ${half} if it is expiring.',
  ],
  'Crypto Card Issuer': [
    'Top up your {name} card with ${capital} on {chain}.',
    'Spend ${half} with your {name} card and keep the receipt.',
    'Top up your {name} card with ${half} from a second asset on {chain}.',
    'Check your {name} card statement on {chain} and top it up by ${half}.',
  ],
  'Uncollateralized Lending': [
    'Supply ${capital} to the {name} lending pool on {chain}.',
    'Supply ${half} to a second {name} pool on {chain} with a different borrower set.',
    'Withdraw ${half} from {name} on {chain} as a test and resupply it.',
    'Check the published borrower report for the {name} pool on {chain}, then supply ${half} more.',
  ],
  Indexes: [
    'Buy ${capital} of the {name} index token on {chain} and hold it.',
    'Buy ${half} more of the {name} index token on {chain} after a rebalance.',
    'Sell ${half} of your {name} index position on {chain} and keep the rest.',
    'Hold ${half} of the {name} index token in a {name} vault on {chain}.',
  ],
  'Interest Rate Derivatives': [
    'Deposit ${capital} as margin on {name} and open one small rate position.',
    'Open a second small rate hedge on {name} with ${half} of margin.',
    'Close ${half} of an open {name} rate position and keep the rest running.',
    'Deposit ${half} more margin on {name} to widen the buffer on your position.',
  ],
  Bridge: [
    'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app.',
    'Bridge ${half} back through {name} as a test and bridge it out again.',
    'Bridge ${half} of USDC to a second chain through {name}.',
    'Bridge ${half} of a second asset through {name} to {chain}.',
  ],
  'Canonical Bridge': [
    'Bridge ${capital} of USDC to {chain} through the {name} canonical bridge.',
    'Bridge ${half} back through {name} as a test.',
    'Use ${half} of bridged funds in a native {chain} app after bridging through {name}.',
    'Bridge ${half} of USDC to {chain} through {name} in a second transaction.',
  ],
  'AI Agents': [
    'Deposit ${capital} into a {name} agent vault on {chain} and keep the shares.',
    'Fund a {name} agent with ${half} on {chain} and check its published activity.',
    'Deposit ${half} into a second {name} agent on {chain}.',
    'Withdraw ${half} from a {name} agent on {chain} as a test and redeposit it.',
  ],
  'Algo-Stables': [
    'Mint ${capital} of the stablecoin through {name} on {chain} against collateral.',
    'Stake ${half} of the {name} stablecoin in its savings vault on {chain}.',
    'Repay ${half} of your {name} stablecoin debt on {chain}.',
    'Mint ${half} more of the stablecoin through {name} on {chain} from a second collateral type.',
  ],
  Launchpad: [
    'Deposit ${capital} into a {name} launch pool on {chain} and keep the position open.',
    'Commit ${half} to a second {name} launch on {chain}.',
    'Stake ${half} through {name} on {chain} to qualify for the next launch.',
    'Claim your allocation from {name} on {chain} only through the link its own page publishes.',
  ],
  Options: [
    'Deposit ${capital} as margin on {name} and open one small option position.',
    'Buy a ${half} protective option on {name} for a position you already hold.',
    'Sell ${half} of covered options through {name} on {chain}.',
    'Close ${half} of an open {name} option position before expiry.',
  ],
  Privacy: [
    'Deposit ${capital} into a {name} private pool on {chain} and keep the position open.',
    'Move ${half} through {name} on {chain} to a fresh wallet you control.',
    'Deposit ${half} into a second {name} pool on {chain}.',
    'Withdraw ${half} from {name} on {chain} to your own wallet as a test.',
  ],
  Synthetics: [
    'Mint ${capital} of a synthetic asset through {name} on {chain} against collateral.',
    'Trade ${half} of the synthetic asset on {name} on {chain}.',
    'Mint ${half} more of the synthetic asset through {name} on {chain}.',
    'Redeem ${half} of your {name} synthetic position on {chain} as a test.',
  ],
  'Stablecoin Issuer': [
    'Mint ${capital} of the stablecoin through {name} on {chain} against collateral.',
    'Deposit ${half} of the stablecoin into a {name} savings vault on {chain}.',
    'Redeem ${half} of the stablecoin through {name} on {chain} as a test and mint it again.',
    'Mint ${half} more of the stablecoin through {name} on {chain}.',
  ],
  'Token Locker': [
    'Lock ${capital} of tokens through {name} on {chain} for the vesting period.',
    'Lock ${half} more through {name} on {chain} in a second locker.',
    'Check the unlock schedule of your {name} lock on {chain}.',
    'Claim ${half} of unlocked tokens from {name} on {chain} only through its own page.',
  ],
  'Decentralized AI': [
    'Deposit ${capital} into a {name} compute pool on {chain} and keep the position open.',
    'Stake ${half} through {name} on {chain} to run one inference job.',
    'Deposit ${half} into a second {name} pool on {chain}.',
    'Withdraw ${half} from {name} on {chain} as a test and redeposit it.',
  ],
  'Reserve Currency': [
    'Buy ${capital} of the reserve asset through {name} on {chain} and hold it.',
    'Stake ${half} of the reserve asset through {name} on {chain}.',
    'Bond ${half} through {name} on {chain} and keep the receipt.',
    'Sell ${half} of your {name} reserve position on {chain} and keep the rest.',
  ],
  'Collateral Management': [
    'Supply ${capital} of collateral to {name} on {chain} and keep the position open.',
    'Move ${half} of collateral between {name} vaults on {chain}.',
    'Add ${half} of collateral to your {name} position on {chain}.',
    'Withdraw ${half} of excess collateral from {name} on {chain} as a test.',
  ],
  DOR: [
    'Deposit ${capital} into a {name} vault on {chain} and keep the shares.',
    'Deposit ${half} into a second {name} vault on {chain}.',
    'Move ${half} between {name} vaults on {chain} after reading the latest report.',
    'Top up your {name} position on {chain} by ${half}.',
  ],
  'NFT Marketplace': [
    'List one NFT for sale on {name} on {chain} at a price you choose.',
    'Buy one NFT for ${half} through {name} on {chain} and hold it.',
    'Make a ${half} offer on an NFT through {name} on {chain}.',
    'Sell ${half} of an NFT position through {name} on {chain} and keep the receipt.',
  ],
  'Options Vault': [
    'Deposit ${capital} into a {name} options vault on {chain} and keep the shares.',
    'Deposit ${half} into a second {name} vault on {chain}.',
    'Withdraw ${half} from your {name} vault on {chain} as a test and redeposit it.',
    'Top up your {name} vault position on {chain} by ${half}.',
  ],
};

/** Fallback set for a category with no table of its own: still four distinct actions. */
const GENERIC_TEMPLATES: string[] = [
  'Deposit ${capital} of USDC into {name} on {chain} and keep the position open.',
  'Swap ${half} of USDC for another asset through {name} on {chain}.',
  'Deposit ${half} into a second {name} product on {chain}.',
  'Hold ${half} of your {name} position on {chain} in a separate wallet as a second tranche.',
];

/** The template set for a protocol's category, or the generic set. */
function templatesFor(p: SnapshotProtocol): string[] {
  return FARM_TEMPLATES[p.category ?? ''] ?? GENERIC_TEMPLATES;
}

/** A small deterministic hash of a slug, so the template rotation is stable per protocol. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** Fill one template's placeholders with the protocol's own figures. */
function fillTemplate(template: string, p: SnapshotProtocol, capital: number, chain: string, hold: number): string {
  return template
    .replace(/{name}/g, p.name)
    .replace(/{chain}/g, chain)
    .replace(/{capital}/g, String(capital))
    .replace(/{half}/g, String(Math.round(capital / 2)))
    .replace(/{hold}/g, String(hold));
}

/**
 * A protocol's farm plan: nine steps. One shared wallet step, four
 * category-specific actions rotated by slug, a second-chain or weekly
 * step, a hold, a claim check and a farm log. Derived only from the
 * protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Every step is a suggested onchain
 * action, never a guaranteed airdrop: the snapshot carries no
 * airdrop flag, and no step claims one.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const half = Math.round(capital / 2);
  const templates = templatesFor(p);
  const start = slugHash(p.slug) % templates.length;
  const picked = [0, 1, 2, 3].map((i) => templates[(start + i) % templates.length]!);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const third: FarmStep =
    secondChain !== null
      ? {
          text: `Repeat the main action on a second chain, ${secondChain}, with half the capital, so the activity is not on one chain only.`,
          cost: `$${half} of capital and about $4 of gas`,
          time: '15 minutes',
        }
      : {
          text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
          cost: 'about $2 of gas a week',
          time: '10 minutes a week',
        };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    ...picked.map((t, i) => {
      // The cost must name the same amount the action moves: templates
      // that act with {capital} cost the full position, {half} ones half.
      const amt = t.includes('${capital}') ? capital : half;
      return {
        text: fillTemplate(t, p, capital, chain, hold),
        cost: `$${amt} of capital and about $${i === 0 ? 8 : 4} of gas`,
        time: i % 2 === 0 ? '15 minutes to set up' : '10 minutes',
      };
    }),
    third,
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
