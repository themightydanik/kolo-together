import catalog from './catalog.json'
export { catalog }
export const moods = [
  ['wonderful', 'Чудово', '☀️'],
  ['good', 'Добре', '🌼'],
  ['calm', 'Спокійно', '🌿'],
  ['tired', 'Втомлено', '🌙'],
  ['anxious', 'Тривожно', '🌧️'],
  ['sad', 'Сумно', '💧'],
  ['irritated', 'Роздратовано', '🔥'],
  ['uncertain', 'Важко визначити', '☁️'],
] as const
export const reactions = [
  ['here', 'Я поруч'],
  ['hug', 'Обіймаю, якщо хочеш'],
  ['talk', 'Хочеш поговорити?'],
  ['presence', 'Можу просто побути поруч'],
  ['thanks', 'Дякую, що поділився(-лася)'],
] as const
export type Questionnaire = (typeof catalog.questionnaires)[number]
export type GameCard = (typeof catalog.cards)[number]
export interface Mood {
  user_id: string
  day: string
  mood: (typeof moods)[number][0]
  intensity: number
  note: string
  support: boolean
  shared: boolean
  version: number
}
export interface ConnectionSession {
  id: string
  a: string
  b: string
  kind: 'game' | 'questionnaire'
  catalog_id: string | null
  status: string
  position: number
  opt_a: boolean
  opt_b: boolean
  created_at: string
}
export interface Answer {
  user_id: string
  slot: number
  draft: string | Record<string, string> | null
  submitted: boolean
  skipped: boolean
  version: number | null
}
export interface Home {
  today: string
  active_game_id: string | null
  moods: Mood[]
  partner_mood: Mood | null
  reactions: { owner_id: string; reaction: string; user_id: string }[]
  game_version: number
  questionnaire_version: number
  events: { session_id: string; position: number }[]
}
export interface Detail {
  session: ConnectionSession
  answers: Answer[]
  card: GameCard | null
  remaining: number
  answer_count: number
  questionnaire: Questionnaire | null
}
export interface Page<T> {
  items: T[]
  next_cursor: Record<string, unknown> | null
}
export interface HistoryItem {
  slot: number
  card: GameCard
  answers: Answer[] | null
}
export interface Write {
  action: string
  id: string | null
  expected: number
  payload: Record<string, unknown>
  request: string
}
export function connectionError(e: unknown) {
  const text =
    e && typeof e === 'object' && 'message' in e ? String(e.message) : ''
  if (/offline|fetch|network/i.test(text))
    return 'Немає зв’язку. Перевірте результат перед повторним надсиланням.'
  if (text === 'connection_categories_locked')
    return 'Залишилися лише відверті категорії. Їх можна добровільно дозволити обом або завершити гру зараз.'
  if (text === 'connection_changed')
    return 'Стан змінився. Оновіть дані й перевірте результат. Нову дію потрібно підтвердити окремо.'
  if (text === 'connection_partner_required')
    return 'Запросіть партнера. Власний настрій можна зберігати вже зараз.'
  if (text === 'connection_not_ready')
    return 'Спочатку обидва завершують свою участь.'
  return 'Не вдалося зберегти. Перевір зв’язок та онови дані.'
}
/** Not psychometrics: per-question ordinal distance or exact semantic option meaning. */
export function compareAnswers(
  q: Questionnaire,
  a: Record<string, string>,
  b: Record<string, string>,
) {
  const points = q.questions.map((x) => {
    const av = a[x.id],
      bv = b[x.id]
    const score =
      x.type === 'scale'
        ? av && bv
          ? 1 - Math.abs(Number(av) - Number(bv)) / 4
          : null
        : av && bv
          ? Number(
              x.options.find((o) => o.id === av)?.meaning ===
                x.options.find((o) => o.id === bv)?.meaning,
            )
          : null
    return { id: x.id, text: x.text, a: av, b: bv, score }
  })
  return {
    points,
    similar: points.filter((p) => p.score !== null && p.score >= 0.75),
    different: points.filter((p) => p.score !== null && p.score <= 0.25),
    interpretation:
      'Відповіді описують ваші сьогоднішні вподобання, а не якість стосунків. Різні потреби можуть співіснувати; жодна відповідь не є правильною для всіх.',
    prompts: [
      'Що у відповіді партнера стало для тебе новим?',
      'У якій ситуації твоя відповідь могла б змінитися?',
      'Яка домовленість залишить місце потребам обох?',
    ],
    actions: [
      'Оберіть одну відмінність і вислухайте одне одного без переконування.',
      'Спробуйте маленьку добровільну домовленість на тиждень.',
      'Потім перевірте, чи комфортно обом, і змініть її за потреби.',
    ],
  }
}
