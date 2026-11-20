import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRAITS, level, money, suggestName } from '../src/utils/featureFormat.ts'

test('source values read in business units', () => {
  assert.equal(TRAITS.priceLevel.format(Math.log(1234)), '€12.34')
  assert.equal(TRAITS.gapToBest.format(Math.log(1.032)), '+3.2%')
  assert.equal(TRAITS.gapToBest.format(Math.log(0.95)), '-5.0%')
  assert.equal(TRAITS.competitors.format(Math.log1p(8.2)), '8.2')
  assert.equal(TRAITS.firstPositionShare.format(0.4), '40.0%')
  assert.equal(TRAITS.changeRateTop3.format(Math.log1p(0.1)), '2.4 / day')
  assert.equal(TRAITS.reactionTime.format(Math.log(3 * 3600)), '3.0 h')
  assert.equal(TRAITS.cutSize.format(Math.log(100 / 90)), '10.0%')
  assert.equal(TRAITS.cutHikeBalance.format(-0.25), '25% more hikes')
  assert.equal(money(123456), '€1,234.56')
})

test('level bands on the scaled value', () => {
  assert.equal(level(0.5), 'High')
  assert.equal(level(0.49), 'Typical')
  assert.equal(level(-0.5), 'Low')
})

test('suggested name comes from the two most distinctive traits', () => {
  const names = ['priceLevel', 'competitors', 'bestTrend', 'firstPositionShare']
  assert.equal(suggestName(names, [0.1, 2.4, -1.2, 0.6]), 'Crowded · falling prices')
  assert.equal(suggestName(names, [0.1, 0.2, -0.3, 0.4]), 'Typical market')
})
