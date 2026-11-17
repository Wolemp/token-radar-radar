// The farm plan: eight steps a reader can follow, each with what it costs and how long it takes.
//
// A plan is derived from the protocol's own record: its category picks the playbook, its chains pick the
// cheapest place to run it, its TVL and age size the stake, the hold and the exit trigger. No protocol name
// is special-cased. Gas prices and ticket sizes are planning figures stated here, not snapshot data: the
// dashboard labels them so, and a reader should check live gas before the first transaction.

import type { SnapshotProtocol } from './model.ts';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A finished plan and the numbers behind its cost lines. */
export interface Plan {
  chain: string;
  capital: number;
  gas_total: number;
  hold_days: number;
  steps: FarmStep[];
}

/** Planning figures for one transaction's gas, by chain: dollars. Anything not listed takes the default. */
const GAS_PER_TX: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.02,
  Sui: 0.02,
  Aptos: 0.02,
  Stellar: 0.01,
  TON: 0.02,
  'Hyperliquid L1': 0.05,
};
const GAS_DEFAULT = 0.25;

/** The most gas a position may burn as a share of its stake before the stake is raised. */
const GAS_SHARE_CAP = 0.04;
const CAPITAL_CEILING = 2000;

export const gasOn = (chain: string): number => GAS_PER_TX[chain] ?? GAS_DEFAULT;

/** The cheapest chain the protocol runs on; the first listed wins a tie, and a bare record gets a neutral name. */
export function cheapestChain(chains: string[]): string {
  let best = chains[0] ?? 'its main chain';
  for (const c of chains) if (gasOn(c) < gasOn(best)) best = c;
  return best;
}

/** A dollar amount in the words a plan uses: $1,800, $0.25. */
export function dollars(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 100) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 10) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

/** A step as one string within the gate's 20..600 characters: its action, then its cost and time. */
export function planText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

type Family = 'lend' | 'vault' | 'basis' | 'dex' | 'perp' | 'rwa' | 'chain' | 'stable' | 'insurance' | 'payments' | 'other';

/** The playbook a category belongs to, read from the words of DefiLlama's own category. */
export function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (c.includes('basis') || c.includes('cedefi')) return 'basis';
  if (c.includes('lend') || c.includes('collateral')) return 'lend';
  if (c.includes('cdp') || c.includes('stablecoin')) return 'stable';
  if (c.includes('dex') || c.includes('liquidity')) return 'dex';
  if (c.includes('deriv') || c.includes('prediction') || c.includes('option') || c.includes('perp')) return 'perp';
  if (c.includes('rwa')) return 'rwa';
  if (c === 'chain' || c.includes('staking') || c.includes('restak') || c.includes('governance')) return 'chain';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('farm') || c.includes('index')) return 'vault';
  return 'other';
}

/** A family's smallest stake worth the trouble, dollars: tokenised-asset products often start at a larger ticket. */
const BASE_CAPITAL: Record<Family, number> = { lend: 200, vault: 200, basis: 200, dex: 200, perp: 300, rwa: 1000, chain: 100, stable: 300, insurance: 100, payments: 100, other: 100 };

/** How long to hold: a younger protocol is likelier to count early users, so it gets the longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The action half of the plan: what to do first, what to add, and what to repeat each week. */
function playbook(f: Family, name: string, chain: string, capital: number, tx: number, once: string): { core: FarmStep; extra: FarmStep; weekly: FarmStep } {
  const g2 = `about ${dollars(tx * 2)} of gas`;
  const half = dollars(capital / 2);
  switch (f) {
    case 'lend':
      return {
        core: { text: `Supply ${dollars(capital)} of a stablecoin to ${name}'s largest lending market on ${chain}; read the market's utilisation and supply cap before you deposit.`, cost: `${dollars(capital)} of capital that stays yours, ${g2}`, time: '20 minutes' },
        extra: { text: `Borrow about 20% of the supplied value against it and repay within the week, so the account shows supply and borrow activity while it stays far from liquidation.`, cost: `${g2} plus under $1 of interest`, time: '15 minutes' },
        weekly: { text: `${once}, check the health factor and the supply rate, and top up or repay if either moved.`, cost: `about ${dollars(tx)} of gas`, time: '10 minutes' },
      };
    case 'vault':
      return {
        core: { text: `Deposit ${dollars(capital)} of a stablecoin into the ${name} vault with the most deposits on ${chain}; read its strategy, fee and withdrawal terms first.`, cost: `${dollars(capital)} of capital that stays yours, ${g2}`, time: '20 minutes' },
        extra: { text: `Add a second, smaller vault (about a quarter of the stake, if the product allows) so the wallet shows more than one strategy, and keep both for the whole window.`, cost: `about ${dollars(capital / 4)} of capital and ${g2}`, time: '15 minutes' },
        weekly: { text: `${once}, open the vault page, check the share price and any change to caps or fees, and compound or rebalance only if the vault offers it.`, cost: `about ${dollars(tx)} of gas`, time: '10 minutes' },
      };
    case 'basis':
      return {
        core: { text: `Deposit ${dollars(capital)} of a stablecoin into ${name}'s delta-neutral strategy on ${chain}; read the redemption window first, since basis products often queue withdrawals for several days.`, cost: `${dollars(capital)} of capital locked for the window, ${g2}`, time: '25 minutes' },
        extra: { text: `Read the product's reserve or funding-rate disclosure and note the figures, so you can tell a funding squeeze from normal drift before it costs you.`, cost: 'free', time: '20 minutes' },
        weekly: { text: `${once}, check the strategy's reported yield and the redemption queue, and note any change in terms.`, cost: 'free', time: '10 minutes' },
      };
    case 'dex':
      return {
        core: { text: `Add ${dollars(capital)} of liquidity, half in each side, to the deepest stable pair on ${name} on ${chain}, to avoid impermanent loss.`, cost: `${dollars(capital)} of capital that stays yours, ${g2}`, time: '20 minutes' },
        extra: { text: `Make two small swaps of about $20 through ${name}'s own interface, one in each direction, so the wallet shows trading as well as liquidity.`, cost: `about ${dollars(tx * 2 + 0.1)} of gas and fees`, time: '10 minutes' },
        weekly: { text: `${once}, add or remove a few dollars of liquidity and make one small swap, so the account has activity in every period.`, cost: `about ${dollars(tx * 2)} of gas`, time: '10 minutes' },
      };
    case 'perp':
      return {
        core: { text: `Deposit ${dollars(capital)} of USDC as margin on ${name} on ${chain} and leave most of it idle in the account.`, cost: `${dollars(capital)} of capital that stays yours, ${g2}`, time: '20 minutes' },
        extra: { text: `Open one small position of about ${half} notional at 2x leverage or less, close it after a day, and repeat on a second market; volume counts, risk should not.`, cost: `about ${dollars(capital / 100)} of fees at 0.05% per side plus ${g2}`, time: '20 minutes' },
        weekly: { text: `${once}, open and close one small position, so volume appears in every period without a real bet.`, cost: `about ${dollars(capital / 200 + tx)} of fees and gas`, time: '10 minutes' },
      };
    case 'rwa':
      return {
        core: { text: `Check who may buy: tokenised-asset products often ask for identity checks or a minimum ticket. If you qualify, buy ${dollars(capital)} of ${name}'s yield-bearing token on ${chain}.`, cost: `${dollars(capital)} of capital, ${g2}, and any onboarding fee`, time: '30 minutes, longer if identity checks apply' },
        extra: { text: `Keep the token in the wallet that was verified and use it once in a venue the protocol lists, if it lists one, so the holding shows on-chain use.`, cost: `${g2}`, time: '15 minutes' },
        weekly: { text: `${once}, check the net asset value and the redemption window and note any change in eligibility.`, cost: 'free', time: '10 minutes' },
      };
    case 'chain':
      return {
        core: { text: `Stake or delegate ${dollars(capital)} of the network's native asset through ${name} on ${chain}, choosing the validator or pool with the most delegations.`, cost: `${dollars(capital)} of capital, ${g2}, with an unbonding wait on exit`, time: '20 minutes' },
        extra: { text: `Use the staked position or its receipt in one app the network lists, such as a lending market or a pool, if the app accepts it.`, cost: `${g2}`, time: '15 minutes' },
        weekly: { text: `${once}, check that the validator or pool is active and its rewards are accruing, and restake any rewards.`, cost: `about ${dollars(tx)} of gas`, time: '10 minutes' },
      };
    case 'stable':
      return {
        core: { text: `Open a position on ${name} on ${chain}: lock collateral worth ${dollars(capital)}, then mint about half that value of its stable asset, keeping the collateral ratio far above the minimum.`, cost: `${dollars(capital)} of collateral that stays yours, ${g2}`, time: '25 minutes' },
        extra: { text: `Put the minted stable asset to work in the protocol's own savings or pool product for the rest of the window.`, cost: `${g2}`, time: '15 minutes' },
        weekly: { text: `${once}, check the collateral ratio and the stable asset's peg, and add collateral if the ratio drifts toward the minimum.`, cost: `about ${dollars(tx)} of gas`, time: '10 minutes' },
      };
    case 'insurance':
      return {
        core: { text: `Buy ${dollars(capital)} of cover on a protocol you already use, or stake into ${name}'s cover pool on ${chain}, after reading what the policy excludes.`, cost: `${dollars(capital)} of capital and a premium of a few dollars, ${g2}`, time: '25 minutes' },
        extra: { text: `Read the pool's payout history and claim rules and note the waiting period, so you know when the cover is in force.`, cost: 'free', time: '15 minutes' },
        weekly: { text: `${once}, check the pool's utilisation and any open claim, and renew cover if it nears its end.`, cost: 'free', time: '10 minutes' },
      };
    case 'payments':
      return {
        core: { text: `Fund a ${name} account or card with ${dollars(capital)} on ${chain} and note the fee schedule and any minimum balance.`, cost: `${dollars(capital)} of balance, ${g2}`, time: '20 minutes' },
        extra: { text: `Make three small real payments of a few dollars each, so the account shows use rather than only a deposit.`, cost: `a few dollars of fees and ${g2}`, time: '15 minutes' },
        weekly: { text: `${once}, make one small payment or transfer through the product.`, cost: `about ${dollars(tx)} of gas and fees`, time: '5 minutes' },
      };
    default:
      return {
        core: { text: `Deposit ${dollars(capital)} of a stablecoin into ${name}'s main product on ${chain} and use its core feature once.`, cost: `${dollars(capital)} of capital that stays yours, ${g2}`, time: '20 minutes' },
        extra: { text: `Read the product's terms and withdrawal rules and note the lockup, so the exit date is on your calendar.`, cost: 'free', time: '15 minutes' },
        weekly: { text: `${once}, open the product and use one core feature, so the account shows activity in every period.`, cost: `about ${dollars(tx)} of gas`, time: '10 minutes' },
      };
  }
}

/** A protocol's farm plan: eight steps, from wallet to review, with costs and times. */
export function farmPlan(p: SnapshotProtocol, age: number | null, implied: number, share: number): Plan {
  // DefiLlama lists a protocol's main chain first, so the plan runs there; a much cheaper listed chain is
  // named as an option, never assumed, because the app may not offer every product on every chain.
  const chain = p.chains[0] ?? 'its main chain';
  const tx = gasOn(chain);
  const cheap = cheapestChain(p.chains);
  const hold = holdDaysFor(age);
  // A chain that costs a dollar or more a transaction gets a fortnightly rhythm, not a weekly one.
  const everyDays = tx >= 1 ? 14 : 7;
  const once = everyDays === 14 ? 'Once every two weeks' : 'Once a week';
  const actions = Math.ceil(hold / everyDays);
  const txCount = 2 + 2 + actions + 2;
  const gas = Math.round(tx * txCount * 100) / 100;
  const family = familyOf(p.category);
  const ceiling = age === null || age < 180 ? CAPITAL_CEILING / 2 : CAPITAL_CEILING;
  const capital = Math.min(ceiling, Math.max(BASE_CAPITAL[family], Math.ceil(gas / GAS_SHARE_CAP / 50) * 50));
  const { core, extra, weekly } = playbook(family, p.name, chain, capital, tx, once);
  const alt = gasOn(cheap) * 5 <= tx ? ` ${cheap} costs about ${dollars(gasOn(cheap))} a transaction and is listed too: use it if the app offers the same product there.` : '';
  const other = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains; ${chain} is listed first.${alt}` : '';
  const gasNote = gas / capital > GAS_SHARE_CAP ? ` Gas is ${Math.round((gas / capital) * 100)}% of the stake here: use a cheaper chain, raise the stake or skip.` : '';
  const share100 = (capital / p.tvl_usd) * share * implied;
  const window = age === null
    ? `${p.name} has no listing date in the record, so treat the window as unknown and keep the stake at the probe size.`
    : age < 180
      ? `${p.name} has been tracked for ${age} days, so early users are the likeliest to be counted if a snapshot is taken.`
      : age < 730
        ? `${p.name} has run ${age} days; a snapshot is likelier to weigh recent activity, so stay active through the window.`
        : `${p.name} has run ${(age / 365).toFixed(1)} years with no token on record: treat the plan as a cheap option, hold the probe size and add no capital.`;
  const steps: FarmStep[] = [
    { text: `Make a fresh wallet for ${chain} that holds only the farm funds, and fund it with the stake plus a gas buffer.${other}`, cost: `${dollars(capital)} stake plus about ${dollars(tx * 4)} of gas buffer`, time: '15 minutes' },
    { text: `Open the protocol's own docs and channels and look for points, a rewards page or an announced snapshot. DefiLlama records no token for ${p.name}, which is not proof it has none.`, cost: 'free', time: '20 minutes' },
    core,
    extra,
    weekly,
    { text: `Hold the position for ${hold} days, about ${actions} ${everyDays === 14 ? 'fortnightly' : 'weekly'} actions.${gasNote} ${window}`, cost: `${dollars(capital)} stays locked; about ${dollars(gas)} of gas over the window`, time: `${hold} days` },
    { text: `Before any claim or approval, confirm the address in the protocol's own channels, never sign an unlimited approval, and revoke approvals after the last deposit. Exit by withdrawing the position once.`, cost: `about ${dollars(tx * 2)} of gas to withdraw`, time: '15 minutes' },
    { text: `Review at the end of the window: if no token or rewards program has appeared, withdraw. Leave early if TVL falls below ${dollars(p.tvl_usd * 0.7)} (30% under today's). At ${Math.round(share * 100)}% of implied value shared pro rata to TVL, this stake would draw about ${dollars(share100)} against ${dollars(gas)} of gas.`, cost: 'free', time: '10 minutes' },
  ];
  return { chain, capital, gas_total: gas, hold_days: hold, steps };
}
