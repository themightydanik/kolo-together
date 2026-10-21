import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const c = JSON.parse(
  await readFile('src/features/connection/catalog.json', 'utf8'),
)
const sql = await readFile(
  'supabase/migrations/20261022120000_emotional_connection.sql',
  'utf8',
)
const seeded = [
  ...sql.matchAll(
    /values \('(card|questionnaire)','([^']+)',1,\$catalog\$(.*?)\$catalog\$::jsonb\);/g,
  ),
].map((m) => ({ kind: m[1], id: m[2], data: JSON.parse(m[3]) }))
assert.equal(c.cards.length, 150)
assert.equal(c.questionnaires.length, 8)
assert.equal(new Set(c.cards.map((x) => x.text)).size, 150)
for (const cat of c.categories)
  assert.equal(c.cards.filter((x) => x.category === cat.id).length, 30)
for (const [kind, items] of [
  ['card', c.cards],
  ['questionnaire', c.questionnaires],
]) {
  assert.equal(seeded.filter((x) => x.kind === kind).length, items.length)
  for (const item of items)
    assert.deepEqual(
      seeded.find((x) => x.kind === kind && x.id === item.id)?.data,
      item,
    )
}
console.log(
  'PASS: versioned JSON/SQL catalogs identical; 150 unique cards, 30/category, 8 questionnaires',
)
