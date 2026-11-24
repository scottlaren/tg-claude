import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMoveOffers, MOVE_OFFER_MS } from '../src/telegram/move-offers.ts'

test('the offer to move cloud projects comes once a day per computer, and a restart does not bring it back', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-move-')), 'move-offers.json')
  const now = Date.now()
  const offers = createMoveOffers(file)
  assert.equal(offers.due('mac', now), true, 'never offered yet')
  offers.made('mac', now)
  assert.equal(offers.due('mac', now + 3600_000), false, 'an hour later: not again')
  assert.equal(offers.due('pc', now + 3600_000), true, 'another computer has its own day')
  // The server restarted for an update: the day goes on
  const again = createMoveOffers(file)
  assert.equal(again.due('mac', now + 2 * 3600_000), false)
  assert.equal(again.due('mac', now + MOVE_OFFER_MS), true, 'a day later it may ask again')
})
