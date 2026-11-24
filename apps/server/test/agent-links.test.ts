import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkNames } from '../src/telegram/agent-links.ts'

const F = 'https://t.me/c/3555000111/12'
const P = 'https://t.me/c/3555000111/14'
const ways = [{ name: 'floor', link: F }, { name: 'prod', link: P }]

test('a head\'s agent named as a name becomes a link to its topic: in quotes, in bold, in code, after the word agent', () => {
  assert.equal(linkNames('Перевёл «floor», который отвечает за монстра, на Fable.', ways), `Перевёл «[floor](${F})», который отвечает за монстра, на Fable.`)
  assert.equal(linkNames('Если он не восстановился, «floor» будет стоять, а "prod" нет.', ways), `Если он не восстановился, «[floor](${F})» будет стоять, а "[prod](${P})" нет.`)
  assert.equal(linkNames('**floor** готов, **Prod** ждёт', ways), `**[floor](${F})** готов, **[Prod](${P})** ждёт`)
  assert.equal(linkNames('Отдал агенту floor, а agent prod is idle', ways), `Отдал агенту [floor](${F}), а agent [prod](${P}) is idle`)
  assert.equal(linkNames('Жду `floor` и `prod`.', ways), `Жду [floor](${F}) и [prod](${P}).`)
})

test('a bare word is no name, and what is already code, a link or an address stays as written', () => {
  assert.equal(linkNames('Выкатили на prod, floor тут просто слово.', ways), 'Выкатили на prod, floor тут просто слово.')
  assert.equal(linkNames('агент floors и «floor2»', ways), 'агент floors и «floor2»')
  const code = '```\necho «floor» **prod**\n```'
  assert.equal(linkNames(code, ways), code)
  assert.equal(linkNames('`npm run prod` и `floor.lua`', ways), '`npm run prod` и `floor.lua`')
  assert.equal(linkNames(`Уже ссылка: [floor](${F}) и «[prod](${P})».`, ways), `Уже ссылка: [floor](${F}) и «[prod](${P})».`)
  assert.equal(linkNames('https://example.com/"floor"/x и <tg-emoji emoji-id="1">«floor»</tg-emoji>', ways), `https://example.com/"floor"/x и <tg-emoji emoji-id="1">«[floor](${F})»</tg-emoji>`)
  assert.equal(linkNames('![«floor»](C:/shots/floor.png)', ways), '![«floor»](C:/shots/floor.png)')
})

test('the longer of two names wins, a name with signs in it is taken as it is, and no agents means no change', () => {
  const two = [{ name: 'floor', link: F }, { name: 'floor-2', link: P }]
  assert.equal(linkNames('«floor-2» и «floor»', two), `«[floor-2](${P})» и «[floor](${F})»`)
  assert.equal(linkNames('агент floor-2 занят', two), `агент [floor-2](${P}) занят`)
  assert.equal(linkNames('«a.b (x)» готов', [{ name: 'a.b (x)', link: F }]), `«[a.b (x)](${F})» готов`)
  assert.equal(linkNames('«axb (x)»', [{ name: 'a.b (x)', link: F }]), '«axb (x)»')
  assert.equal(linkNames('«floor»', []), '«floor»')
  assert.equal(linkNames('', ways), '')
})
