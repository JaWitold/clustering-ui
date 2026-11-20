// Turns feature-vector values (source units of graph-v2 FeatureVectorCalculator: log prices in cents,
// log1p rates per hour/day, log seconds, shares 0..1) into numbers sales people can read.

export type Level = 'Low' | 'Typical' | 'High'

export interface Trait {
  label: string
  hint: string
  format: (value: number) => string
  words: [low: string, high: string]
}

export const money = (cents: number): string =>
  `€${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const percent = (value: number, signed = false): string => `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}%`
const lnRatio = (value: number): string => percent((Math.exp(value) - 1) * 100, true)
const share = (value: number): string => percent(value * 100)
const perDay = (value: number): string => `${value.toFixed(1)} / day`

// scaled = (value − market median) / IQR, so ±0.5 is half an interquartile range away from a typical auction
export const level = (scaled: number): Level => (scaled >= 0.5 ? 'High' : scaled <= -0.5 ? 'Low' : 'Typical')

export const TRAITS: Record<string, Trait> = {
  priceLevel: { label: 'Best price', hint: 'Typical cheapest price on the product', format: (v) => money(Math.exp(v)), words: ['cheap games', 'pricey games'] },
  competitors: { label: 'Sellers', hint: 'Sellers competing on the product', format: (v) => Math.expm1(v).toFixed(1), words: ['few sellers', 'crowded'] },
  gapToBest: { label: 'Our gap to best', hint: 'Our price vs. the cheapest one (negative = we are cheaper)', format: lnRatio, words: ['we lead on price', 'we sit above best'] },
  firstPositionShare: { label: 'We are #1', hint: 'Share of the time we held first place', format: share, words: ['rarely #1', 'usually #1'] },
  changeRateTop3: { label: 'Top-3 price changes', hint: 'Price changes per day by the three cheapest sellers', format: (v) => perDay(Math.expm1(v) * 24), words: ['calm top 3', 'busy top 3'] },
  bestTrend: { label: 'Best price trend', hint: 'Daily change of the cheapest price', format: (v) => `${lnRatio(v)} / day`, words: ['falling prices', 'rising prices'] },
  spreadTop3: { label: 'Top-3 spread', hint: 'How much more the 3rd cheapest offer costs than the cheapest', format: lnRatio, words: ['tight top 3', 'spread-out top 3'] },
  density5Pct: { label: 'Sellers within 5%', hint: 'Sellers priced within 5% of the cheapest', format: (v) => v.toFixed(1), words: ['loose pack', 'tight pack'] },
  changeRateMedian: { label: 'Typical seller changes', hint: 'Price changes per day by a typical seller', format: (v) => perDay(Math.expm1(v) * 24), words: ['sellers sit still', 'sellers reprice often'] },
  activeChangers: { label: 'Sellers changing price', hint: 'Share of sellers that changed their price', format: share, words: ['few repricers', 'many repricers'] },
  leaderChurn: { label: 'Leader changes', hint: 'How often the cheapest seller changes', format: (v) => perDay(Math.expm1(v)), words: ['stable leader', 'leader keeps changing'] },
  reactionTime: { label: 'Time to be undercut', hint: 'Hours until a change of the cheapest price is undercut', format: (v) => `${(Math.exp(v) / 3600).toFixed(1)} h`, words: ['instant undercuts', 'slow undercuts'] },
  reactionTimeMissing: { label: 'Days without reaction', hint: 'Share of days nobody reacted to a price change', format: share, words: ['changes get answered', 'changes go unanswered'] },
  undercutRate: { label: 'Our undercuts', hint: 'How often we undercut the cheapest seller', format: (v) => perDay(Math.expm1(v)), words: ['we rarely undercut', 'we undercut a lot'] },
  cutHikeBalance: {
    label: 'Cuts vs. hikes',
    hint: 'Whether sellers mostly cut or raise prices',
    format: (v) => `${Math.abs(v * 100).toFixed(0)}% more ${v >= 0 ? 'cuts' : 'hikes'}`,
    words: ['mostly raises', 'mostly cuts'],
  },
  cutSize: { label: 'Typical cut', hint: 'Size of a typical price cut', format: (v) => percent((1 - Math.exp(-v)) * 100), words: ['small cuts', 'deep cuts'] },
  hikeSize: { label: 'Typical hike', hint: 'Size of a typical price raise', format: (v) => percent((Math.exp(v) - 1) * 100), words: ['small raises', 'big raises'] },
  bestAccel: { label: 'Trend change', hint: 'Whether the price trend sped up (+) or slowed (−) in the second half', format: (v) => `${(v * 100).toFixed(2)} pp / day`, words: ['trend slowing', 'trend speeding up'] },
  bestVolatility: { label: 'Best price swings', hint: 'How much the cheapest price moves around', format: share, words: ['steady price', 'jumpy price'] },
}

// Traits furthest from a typical auction, most distinctive first (only |scaled| ≥ 0.5 counts)
export const standsOut = (featureNames: string[], scaled: number[], limit = 2): { name: string; scaled: number }[] =>
  featureNames
    .map((name, i) => ({ name, scaled: scaled[i] }))
    .filter((t) => TRAITS[t.name] && level(t.scaled) !== 'Typical')
    .sort((a, b) => Math.abs(b.scaled) - Math.abs(a.scaled))
    .slice(0, limit)

export const suggestName = (featureNames: string[], scaled: number[]): string => {
  const words = standsOut(featureNames, scaled).map((t) => TRAITS[t.name].words[t.scaled > 0 ? 1 : 0])
  const name = words.length ? words.join(' · ') : 'typical market'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const KEY_TRAITS = ['priceLevel', 'competitors', 'gapToBest', 'firstPositionShare', 'changeRateTop3', 'bestTrend']
