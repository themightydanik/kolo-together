import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const current = JSON.parse(
    await readFile('src/features/connection/catalog.json', 'utf8'),
  ),
  legacy = JSON.parse(
    await readFile('src/features/connection/catalog.v1.json', 'utf8'),
  )
for (const [version, c, file] of [
  [1, legacy, '20261022120000_emotional_connection.sql'],
  [2, current, '20261023120000_product_experience_catalog.sql'],
]) {
  const sql = await readFile('supabase/migrations/' + file, 'utf8'),
    seeded = [
      ...sql.matchAll(
        /values \('(card|questionnaire)','([^']+)',[12],\$catalog\$(.*?)\$catalog\$::jsonb\);/g,
      ),
    ].map((m) => ({ kind: m[1], id: m[2], data: JSON.parse(m[3]) }))
  assert.equal(c.cards.length, 150)
  assert.equal(new Set(c.cards.map((x) => x.id)).size, 150)
  assert.equal(new Set(c.cards.map((x) => x.text)).size, 150)
  for (const cat of c.categories)
    assert.equal(c.cards.filter((x) => x.category === cat.id).length, 30)
  assert.equal(seeded.filter((x) => x.kind === 'card').length, 150)
  for (const card of c.cards) {
    assert.equal(card.version, version)
    assert.deepEqual(
      seeded.find((x) => x.kind === 'card' && x.id === card.id)?.data,
      card,
    )
    if (version === 2) {
      assert.ok(legacy.cards.some((x) => x.id === card.previous_id))
      assert.ok(!legacy.cards.some((x) => x.id === card.id))
    }
  }
  if (version === 1)
    for (const q of c.questionnaires)
      assert.deepEqual(
        seeded.find((x) => x.kind === 'questionnaire' && x.id === q.id)?.data,
        q,
      )
}
assert.deepEqual(current.questionnaires, legacy.questionnaires)
console.log(
  'PASS: immutable v1 + additive v2; each 150 unique cards, 30/category, matching SQL/JSON, questionnaires unchanged',
)
