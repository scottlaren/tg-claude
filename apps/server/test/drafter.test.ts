import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDrafter } from '../src/telegram/drafter.ts'

test('stop waits for a draft already on its way, so it cannot land after the final message', async () => {
  const order: string[] = []
  const drafter = createDrafter(() => 'draft', async () => {
    order.push('draft sent')
    await new Promise(r => setTimeout(r, 100))
    order.push('draft done')
  }, { minGap: 0 })
  drafter.kick()
  await new Promise(r => setTimeout(r, 20)) // the send is in flight now
  await drafter.stop()
  order.push('final message')
  assert.deepEqual(order, ['draft sent', 'draft done', 'final message'])
})

test('nothing is sent after stop', async () => {
  let sends = 0
  const drafter = createDrafter(() => 'draft', async () => { sends++ }, { minGap: 50 })
  await drafter.stop()
  drafter.kick()
  await new Promise(r => setTimeout(r, 100))
  assert.equal(sends, 0)
})
