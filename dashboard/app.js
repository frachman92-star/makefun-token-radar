// Token Radar dashboard. Reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, filters, a per-protocol
// detail view with the model's own inputs and the farm plan, and a
// live-token view kept apart from the ranking. No network: every byte
// it shows is in data.js. A protocol detail can be deep-linked as
// #/protocol/<slug>; opening or closing a detail updates the hash, and
// loading that hash opens the detail. The board can be downloaded as
// CSV with the "Copy board as CSV" button.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var WATCH = {};
  DATA.rows.forEach(function (r) { WATCH[r.slug] = false; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the
  // snapshot figures and checks the number board.json carries, so the
  // page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    var breadth = 1 + extra * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plan: the same derivation main.ts writes to board.json.
  // Category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased. Each step is
  // a suggested onchain action, never a guaranteed airdrop. Every
  // category has at least four templates; a row picks four of them,
  // rotated by its slug, so rows in one category differ.
  var FARM_TEMPLATES = {
    'Risk Curators': [
      'Deposit ${capital} into a {name} vault on {chain} and keep the vault shares.',
      'Deposit ${half} into a second {name} vault on {chain} with a different risk profile.',
      'Move ${half} between two {name} vaults on {chain} after comparing their published allocations.',
      'Add ${half} to your {name} vault position on {chain} and leave it in the vault.'
    ],
    Dexs: [
      'Provide ${capital} of liquidity to the main {name} pool on {chain} and keep the position open.',
      'Swap ${half} of USDC for the other asset in the pool through {name} on {chain}.',
      'Add ${half} of liquidity to a second {name} pool on {chain}.',
      'Provide ${half} of single-sided liquidity to {name} on {chain} if the pool supports it.'
    ],
    'Onchain Capital Allocator': [
      'Deposit ${capital} into a {name} allocation vault on {chain} and keep the shares.',
      'Allocate ${half} to a second {name} strategy on {chain}.',
      'Move ${half} between {name} strategies on {chain} after reading the latest strategy report.',
      'Top up your {name} allocation on {chain} by ${half} and hold the position.'
    ],
    RWA: [
      'Mint ${capital} of the yield-bearing asset through {name} on {chain} and hold it.',
      'Buy ${half} of a tokenised asset through {name} on {chain} on the secondary market.',
      'Mint ${half} more of the {name} yield asset on {chain} after checking its redemption terms.',
      'Hold ${half} of the {name} asset in a second position on {chain} as a separate tranche.'
    ],
    Lending: [
      'Supply ${capital} of USDC to {name} on {chain} and keep the supply position open.',
      'Borrow ${half} of USDC against your supplied collateral on {name} and repay it within the same week.',
      'Supply ${half} of a second asset to {name} on {chain} alongside your USDC.',
      'Repay ${half} of an open {name} borrow on {chain} and check the position health factor.'
    ],
    Yield: [
      'Deposit ${capital} into a {name} yield vault on {chain} and keep the shares.',
      'Stake ${half} in a second {name} vault on {chain}.',
      'Compound ${half} of accrued rewards back into your {name} position on {chain}.',
      'Move ${half} between two {name} vaults on {chain} after comparing their published strategies.'
    ],
    Derivatives: [
      'Deposit ${capital} of USDC as margin on {name} and open one small hedge.',
      'Open a second small hedge on {name} with ${half} of margin.',
      'Close ${half} of an open {name} position and keep the rest running.',
      'Deposit ${half} more margin on {name} to widen the buffer on your open position.'
    ],
    CDP: [
      'Lock ${capital} of collateral in {name} on {chain} and mint stablecoins against it.',
      'Repay ${half} of your {name} debt on {chain} and check the collateral ratio.',
      'Add ${half} of collateral to your {name} position on {chain}.',
      'Mint ${half} of stablecoins from a second {name} collateral type on {chain}.'
    ],
    'Yield Aggregator': [
      'Deposit ${capital} into a {name} aggregator vault on {chain} and keep the shares.',
      'Switch ${half} of your {name} deposit to a different strategy in the same vault.',
      'Deposit ${half} into a second {name} vault on {chain}.',
      'Compound ${half} back into your {name} vault on {chain} instead of withdrawing it.'
    ],
    'Basis Trading': [
      'Deposit ${capital} into a {name} basis vault on {chain} and keep the shares.',
      'Add ${half} to your {name} basis position on {chain} after checking the funding rate.',
      'Deposit ${half} into a second {name} basis strategy on {chain}.',
      'Withdraw ${half} from your {name} position on {chain} as a test and redeposit it.'
    ],
    Chain: [
      'Bridge ${capital} of USDC to {chain} through the chain own bridge and use it in a native app.',
      'Stake ${half} of the chain native asset on {chain} through a validator.',
      'Swap ${half} on a native {chain} dex and hold the received asset.',
      'Vote on one {chain} governance proposal with ${half} of voting power if you hold it.'
    ],
    'Staking Pool': [
      'Stake ${capital} of the chain staking asset in the {name} pool on {chain} and keep the receipt.',
      'Delegate ${half} to a second validator through {name} on {chain}.',
      'Restake ${half} of accrued staking rewards through {name} on {chain}.',
      'Unstake ${half} as a test from {name} on {chain} and restake it.'
    ],
    'Liquidity Manager': [
      'Deposit ${capital} into a {name} managed liquidity position on {chain}.',
      'Rebalance ${half} of your {name} range on {chain} after a price move.',
      'Add ${half} to a second {name} managed range on {chain}.',
      'Withdraw ${half} from your {name} position on {chain} and redeposit it in a narrower range.'
    ],
    'Prediction Market': [
      'Fund ${capital} and place one market position on {name}.',
      'Place a second ${half} position on a different {name} market.',
      'Trade out of ${half} of an open {name} position before it resolves.',
      'Add ${half} to an open {name} market position you already hold.'
    ],
    Restaking: [
      'Restake ${capital} of the staking receipt through {name} and keep the new receipt.',
      'Delegate ${half} of your restaked position to a second operator through {name}.',
      'Restake ${half} more of the staking asset through {name} on {chain}.',
      'Unstake ${half} from {name} as a test and restake it with a different operator.'
    ],
    'Stablecoin Wrapper': [
      'Wrap ${capital} of the stablecoin through {name} on {chain} and hold the wrapped asset.',
      'Use ${half} of the wrapped asset in a {name} pool on {chain}.',
      'Unwrap ${half} through {name} on {chain} as a test and wrap it again.',
      'Wrap ${half} more of the stablecoin through {name} on {chain}.'
    ],
    CeDeFi: [
      'Deposit ${capital} into {name} on {chain} and keep the position open.',
      'Check the published proof of reserves for {name}, then deposit ${half} more on {chain}.',
      'Withdraw ${half} from {name} on {chain} as a test and redeposit it.',
      'Move ${half} between two {name} products on {chain}.'
    ],
    Farm: [
      'Deposit ${capital} of LP tokens into the {name} farm on {chain}.',
      'Harvest ${half} of accrued farm rewards on {name} and compound them back in.',
      'Deposit ${half} of LP tokens into a second {name} farm pool on {chain}.',
      'Stake ${half} of the farm receipt token in the {name} staking pool on {chain}.'
    ],
    'Anchor BTC': [
      'Mint ${capital} of the BTC-anchored asset through {name} on {chain} and hold it.',
      'Use ${half} of the anchored asset as collateral on {name} on {chain}.',
      'Redeem ${half} of the anchored asset through {name} on {chain} as a test and mint it again.',
      'Hold ${half} of the anchored asset in a {name} vault on {chain}.'
    ],
    'Leveraged Farming': [
      'Open a small leveraged farm position on {name} with ${capital} of collateral on {chain}.',
      'Add ${half} of collateral to your {name} leveraged position on {chain}.',
      'Reduce ${half} of your {name} leveraged position on {chain} after a price move.',
      'Close ${half} of the {name} position on {chain} and keep the rest running.'
    ],
    'Dual-Token Stablecoin': [
      'Mint ${capital} of the stablecoin through {name} on {chain} against collateral.',
      'Stake ${half} of the protocol second token through {name} on {chain}.',
      'Mint ${half} more of the stablecoin through {name} on {chain} from a second collateral type.',
      'Repay ${half} of your {name} stablecoin debt on {chain} and check the peg.'
    ],
    'Decentralized BTC': [
      'Mint ${capital} of the BTC-backed asset through {name} on {chain} and hold it.',
      'Deposit ${half} of the BTC-backed asset into a {name} vault on {chain}.',
      'Use ${half} of the BTC-backed asset as collateral on {name} on {chain}.',
      'Redeem ${half} of the BTC-backed asset through {name} on {chain} as a test.'
    ],
    'Collateral Markets': [
      'Supply ${capital} of collateral to a {name} market on {chain}.',
      'Borrow ${half} against your {name} collateral on {chain} and repay it within the week.',
      'Supply ${half} of a second collateral type to {name} on {chain}.',
      'Repay ${half} of an open {name} borrow on {chain} and check the market health factor.'
    ],
    'CDP Manager': [
      'Open a {name} vault with ${capital} of collateral on {chain} and mint stablecoins.',
      'Adjust your {name} vault by adding ${half} of collateral on {chain}.',
      'Repay ${half} of your {name} vault debt on {chain}.',
      'Open a second {name} vault with ${half} of a different collateral type on {chain}.'
    ],
    Payments: [
      'Send ${capital} through {name} on {chain} and keep the receipt.',
      'Receive ${half} through {name} on {chain} into your farming wallet.',
      'Pay one invoice of ${half} through {name} on {chain}.',
      'Send ${half} through {name} on {chain} to a second wallet you control as a test.'
    ],
    'OTC Marketplace': [
      'Place a small OTC order of ${capital} through {name} on {chain}.',
      'Settle a ${half} OTC trade through {name} on {chain} and keep the receipt.',
      'List ${half} for an OTC sale through {name} on {chain}.',
      'Buy ${half} through a {name} OTC order on {chain} and check settlement.'
    ],
    'Cross Chain Bridge': [
      'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app.',
      'Bridge ${half} back through {name} as a test and bridge it out again.',
      'Bridge ${half} of USDC to a second chain through {name}.',
      'Use ${half} of bridged funds in a {name}-supported app on {chain}.'
    ],
    'Governance Incentives': [
      'Vote on one {name} proposal with ${half} of voting power on {chain}.',
      'Delegate ${half} of your voting power through {name} on {chain}.',
      'Claim incentives from {name} on {chain} only through the link its own page publishes.',
      'Vote on a second {name} proposal on {chain} after reading the discussion.'
    ],
    Insurance: [
      'Buy ${capital} of cover from {name} on {chain} and keep the policy.',
      'Buy ${half} of cover for a second protocol from {name} on {chain}.',
      'Top up your {name} cover on {chain} by ${half}.',
      'Check your {name} policy terms on {chain} and extend the cover by ${half} if it is expiring.'
    ],
    'Crypto Card Issuer': [
      'Top up your {name} card with ${capital} on {chain}.',
      'Spend ${half} with your {name} card and keep the receipt.',
      'Top up your {name} card with ${half} from a second asset on {chain}.',
      'Check your {name} card statement on {chain} and top it up by ${half}.'
    ],
    'Uncollateralized Lending': [
      'Supply ${capital} to the {name} lending pool on {chain}.',
      'Supply ${half} to a second {name} pool on {chain} with a different borrower set.',
      'Withdraw ${half} from {name} on {chain} as a test and resupply it.',
      'Check the published borrower report for the {name} pool on {chain}, then supply ${half} more.'
    ],
    Indexes: [
      'Buy ${capital} of the {name} index token on {chain} and hold it.',
      'Buy ${half} more of the {name} index token on {chain} after a rebalance.',
      'Sell ${half} of your {name} index position on {chain} and keep the rest.',
      'Hold ${half} of the {name} index token in a {name} vault on {chain}.'
    ],
    'Interest Rate Derivatives': [
      'Deposit ${capital} as margin on {name} and open one small rate position.',
      'Open a second small rate hedge on {name} with ${half} of margin.',
      'Close ${half} of an open {name} rate position and keep the rest running.',
      'Deposit ${half} more margin on {name} to widen the buffer on your position.'
    ],
    Bridge: [
      'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app.',
      'Bridge ${half} back through {name} as a test and bridge it out again.',
      'Bridge ${half} of USDC to a second chain through {name}.',
      'Bridge ${half} of a second asset through {name} to {chain}.'
    ],
    'Canonical Bridge': [
      'Bridge ${capital} of USDC to {chain} through the {name} canonical bridge.',
      'Bridge ${half} back through {name} as a test.',
      'Use ${half} of bridged funds in a native {chain} app after bridging through {name}.',
      'Bridge ${half} of USDC to {chain} through {name} in a second transaction.'
    ],
    'AI Agents': [
      'Deposit ${capital} into a {name} agent vault on {chain} and keep the shares.',
      'Fund a {name} agent with ${half} on {chain} and check its published activity.',
      'Deposit ${half} into a second {name} agent on {chain}.',
      'Withdraw ${half} from a {name} agent on {chain} as a test and redeposit it.'
    ],
    'Algo-Stables': [
      'Mint ${capital} of the stablecoin through {name} on {chain} against collateral.',
      'Stake ${half} of the {name} stablecoin in its savings vault on {chain}.',
      'Repay ${half} of your {name} stablecoin debt on {chain}.',
      'Mint ${half} more of the stablecoin through {name} on {chain} from a second collateral type.'
    ],
    Launchpad: [
      'Deposit ${capital} into a {name} launch pool on {chain} and keep the position open.',
      'Commit ${half} to a second {name} launch on {chain}.',
      'Stake ${half} through {name} on {chain} to qualify for the next launch.',
      'Claim your allocation from {name} on {chain} only through the link its own page publishes.'
    ],
    Options: [
      'Deposit ${capital} as margin on {name} and open one small option position.',
      'Buy a ${half} protective option on {name} for a position you already hold.',
      'Sell ${half} of covered options through {name} on {chain}.',
      'Close ${half} of an open {name} option position before expiry.'
    ],
    Privacy: [
      'Deposit ${capital} into a {name} private pool on {chain} and keep the position open.',
      'Move ${half} through {name} on {chain} to a fresh wallet you control.',
      'Deposit ${half} into a second {name} pool on {chain}.',
      'Withdraw ${half} from {name} on {chain} to your own wallet as a test.'
    ],
    Synthetics: [
      'Mint ${capital} of a synthetic asset through {name} on {chain} against collateral.',
      'Trade ${half} of the synthetic asset on {name} on {chain}.',
      'Mint ${half} more of the synthetic asset through {name} on {chain}.',
      'Redeem ${half} of your {name} synthetic position on {chain} as a test.'
    ],
    'Stablecoin Issuer': [
      'Mint ${capital} of the stablecoin through {name} on {chain} against collateral.',
      'Deposit ${half} of the stablecoin into a {name} savings vault on {chain}.',
      'Redeem ${half} of the stablecoin through {name} on {chain} as a test and mint it again.',
      'Mint ${half} more of the stablecoin through {name} on {chain}.'
    ],
    'Token Locker': [
      'Lock ${capital} of tokens through {name} on {chain} for the vesting period.',
      'Lock ${half} more through {name} on {chain} in a second locker.',
      'Check the unlock schedule of your {name} lock on {chain}.',
      'Claim ${half} of unlocked tokens from {name} on {chain} only through its own page.'
    ],
    'Decentralized AI': [
      'Deposit ${capital} into a {name} compute pool on {chain} and keep the position open.',
      'Stake ${half} through {name} on {chain} to run one inference job.',
      'Deposit ${half} into a second {name} pool on {chain}.',
      'Withdraw ${half} from {name} on {chain} as a test and redeposit it.'
    ],
    'Reserve Currency': [
      'Buy ${capital} of the reserve asset through {name} on {chain} and hold it.',
      'Stake ${half} of the reserve asset through {name} on {chain}.',
      'Bond ${half} through {name} on {chain} and keep the receipt.',
      'Sell ${half} of your {name} reserve position on {chain} and keep the rest.'
    ],
    'Collateral Management': [
      'Supply ${capital} of collateral to {name} on {chain} and keep the position open.',
      'Move ${half} of collateral between {name} vaults on {chain}.',
      'Add ${half} of collateral to your {name} position on {chain}.',
      'Withdraw ${half} of excess collateral from {name} on {chain} as a test.'
    ],
    DOR: [
      'Deposit ${capital} into a {name} vault on {chain} and keep the shares.',
      'Deposit ${half} into a second {name} vault on {chain}.',
      'Move ${half} between {name} vaults on {chain} after reading the latest report.',
      'Top up your {name} position on {chain} by ${half}.'
    ],
    'NFT Marketplace': [
      'List one NFT for sale on {name} on {chain} at a price you choose.',
      'Buy one NFT for ${half} through {name} on {chain} and hold it.',
      'Make a ${half} offer on an NFT through {name} on {chain}.',
      'Sell ${half} of an NFT position through {name} on {chain} and keep the receipt.'
    ],
    'Options Vault': [
      'Deposit ${capital} into a {name} options vault on {chain} and keep the shares.',
      'Deposit ${half} into a second {name} vault on {chain}.',
      'Withdraw ${half} from your {name} vault on {chain} as a test and redeposit it.',
      'Top up your {name} vault position on {chain} by ${half}.'
    ]
  };
  var GENERIC_TEMPLATES = [
    'Deposit ${capital} of USDC into {name} on {chain} and keep the position open.',
    'Swap ${half} of USDC for another asset through {name} on {chain}.',
    'Deposit ${half} into a second {name} product on {chain}.',
    'Hold ${half} of your {name} position on {chain} in a separate wallet as a second tranche.'
  ];
  function templatesFor(p) { return FARM_TEMPLATES[p.category || ''] || GENERIC_TEMPLATES; }
  function slugHash(slug) {
    var h = 0;
    for (var i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
    return h;
  }
  function fillTemplate(template, p, capital, chain, hold) {
    return template
      .replace(/{name}/g, p.name)
      .replace(/{chain}/g, chain)
      .replace(/{capital}/g, String(capital))
      .replace(/{half}/g, String(Math.round(capital / 2)))
      .replace(/{hold}/g, String(hold));
  }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var half = Math.round(capital / 2);
    var templates = templatesFor(p);
    var start = slugHash(p.slug) % templates.length;
    var picked = [0, 1, 2, 3].map(function (i) { return templates[(start + i) % templates.length]; });
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var third = second !== null
      ? { text: 'Repeat the main action on a second chain, ' + second + ', with half the capital, so the activity is not on one chain only.', cost: '$' + half + ' of capital and about $4 of gas', time: '15 minutes' }
      : { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' };
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' }
    ];
    picked.forEach(function (t, i) {
      // The cost must name the same amount the action moves: templates
      // that act with {capital} cost the full position, {half} ones half.
      var amt = t.indexOf('${capital}') >= 0 ? capital : half;
      steps.push({
        text: fillTemplate(t, p, capital, chain, hold),
        cost: '$' + amt + ' of capital and about $' + (i === 0 ? 8 : 4) + ' of gas',
        time: i % 2 === 0 ? '15 minutes to set up' : '10 minutes'
      });
    });
    steps.push(third);
    steps.push({ text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
    steps.push({ text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' });
    steps.push({ text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
    return steps.map(stepText);
  }

  // Deep links: #/protocol/<slug> opens that protocol's detail view.
  // The older filter hash (#q=..&category=..&p=<slug>) still loads too.
  function hashSlug(raw) {
    if (raw.indexOf('/protocol/') === 0) {
      var slug = raw.slice('/protocol/'.length).split('?')[0].split('/')[0];
      try { return decodeURIComponent(slug); } catch (e) { return slug; }
    }
    return null;
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var slug = hashSlug(hash);
    if (slug) { state.selected = slug; return; }
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    if (state.selected) {
      window.history.replaceState(null, '', '#/protocol/' + encodeURIComponent(state.selected));
      return;
    }
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // Download the rows currently visible (after filters and sorting) as CSV.
  function csvEscape(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var list = sortedRows(rows());
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'board'];
    var lines = [head.join(',')];
    list.forEach(function (r) {
      lines.push([
        r.rank, r.slug, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
        r.implied_value_usd, WATCH[r.slug] ? 'watchlist' : 'early'
      ].map(csvEscape).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows.slice(0, 3);
    var pods = top.map(function (r) {
      return el('div', { class: 'pod' },
        el('b', { text: '#' + r.rank }),
        el('span', { text: r.name + ' (' + (r.category || 'Other') + ')' }),
        el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }));
    });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The board ranks every protocol that passes the same test, ' + DATA.board_size + ' rows in all, including ' + DATA.early_size + ' below the floor.' }),
        el('p', { class: 'warn', text: 'Implied value is a model estimate, not a price. "No token" means DefiLlama records none, not proof the protocol has none. No farm step promises an airdrop.' }),
        el('div', { class: 'top3' }, pods)
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var tvl = el('select', { id: 'minTvl', 'aria-label': 'Filter by minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '10000000', text: 'TVL $10M+' }),
      el('option', { value: '50000000', text: 'TVL $50M+' }),
      el('option', { value: '100000000', text: 'TVL $100M+' }),
      el('option', { value: '500000000', text: 'TVL $500M+' })
    );
    tvl.value = String(state.minTvl);
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value) || 0; writeHash(); render(); });
    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var csv = el('button', { class: 'button', type: 'button', text: 'Copy board as CSV', onclick: downloadCsv });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvl),
      el('label', { class: 'check', for: 'watch' }, watch, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      csv,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, WATCH[r.slug] ? el('span', { class: 'badge watch', text: 'watchlist' }) : el('span', { class: 'badge', text: 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.03 x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth is how many chains the protocol runs on. The board ranks every protocol that passes the watchlist test, not only the watchlist itself, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' - watchlist' : ' - early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and no airdrop is promised.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'Suggested onchain actions, not a guaranteed airdrop.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  // The watchlist is the snapshot's own list: mark it from the board's
  // source data, which main.ts writes into data.js as watchlist flags.
  if (DATA.watchlist_slugs) DATA.watchlist_slugs.forEach(function (s) { WATCH[s] = true; });
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  // A deep link pasted in later (or back/forward) opens or closes the
  // detail, and a filter hash pasted in later applies those filters.
  window.addEventListener('hashchange', function () {
    var raw = window.location.hash.replace(/^#/, '');
    var next = hashSlug(raw);
    var q = '', category = 'all', chain = 'all', minTvl = 0, tab = 'pre-token', watchOnly = false;
    if (next === null && raw) {
      var params = new URLSearchParams(raw);
      q = params.get('q') || '';
      if (params.get('p')) next = params.get('p');
      if (params.get('category')) category = params.get('category');
      if (params.get('chain')) chain = params.get('chain');
      if (params.get('minTvl')) minTvl = Number(params.get('minTvl')) || 0;
      if (params.get('tab')) tab = params.get('tab');
      watchOnly = params.get('watch') === '1';
    }
    var changed = next !== state.selected || q !== state.q || category !== state.category ||
      chain !== state.chain || minTvl !== state.minTvl || tab !== state.tab || watchOnly !== state.watchOnly;
    if (!changed) return;
    state.selected = next; state.q = q; state.category = category; state.chain = chain;
    state.minTvl = minTvl; state.tab = tab; state.watchOnly = watchOnly;
    if (!next && dialog.open) dialog.close();
    render();
  });
})();
