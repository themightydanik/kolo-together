# Supabase: Auth, профили и пространство пары

## Границы этапа

Auth и данные профиля/пары используют настоящий Supabase при наличии публичной конфигурации. Без неё включается явно отмеченный деморежим без пользовательской сессии. Этап 3 добавляет реальные задания и серверные игровые начисления; подписки, кошельки и обмен наград не реализованы. Будущие разделы показывают состояния ожидания, а не демоданные под видом реальных данных. Подробные правила: [tasks-economy.md](tasks-economy.md).

## Переменные приложения

Скопируйте `.env.example` в игнорируемый `.env.local`:

- `VITE_SUPABASE_URL`: HTTPS URL проекта (для локального Supabase допустим HTTP localhost/127.0.0.1).
- `VITE_SUPABASE_PUBLISHABLE_KEY`: **публичный** publishable key (или legacy anon key) того же проекта.

Никаких service_role / secret / database credentials в VITE-переменных, исходниках, PR или чате. Перезапустите Vite после изменения окружения. Для Netlify эти публичные переменные задаются на этапе сборки. URL должен быть доступен через сетевую политику cloud-среды; настройки удалённого проекта в этой задаче не менялись.

## Миграция

`supabase/migrations/20261019150000_auth_profiles_couples.sql` создаёт:

- `profiles` с FK на `auth.users`, триггером создания, backfill существующих пользователей и обновлением `updated_at`;
- `couple_spaces`, `couple_members`, `couple_invitations`;
- RLS для всех четырёх таблиц, ограниченные grants;
- RPC `create_couple_space`, `create_couple_invitation`, `inspect_couple_invitation`, `resolve_couple_invitation`, `leave_couple_space` и внутренние helpers.

Сначала проверьте миграцию на **отдельном тестовом проекте**, после резервной копии и проверки целевого project ref. Не применяйте к production без отдельного подтверждения. В этой задаче удалённые миграции не выполняются.

Для локального полного Supabase (нужны Docker и Supabase CLI):

```sh
supabase init   # только если локального config.toml ещё нет
supabase start
supabase db reset --local
```

`reset --local` удаляет локальные данные, поэтому выполняйте его только в отдельной тестовой среде. Локальные URL/ключ доступны через `supabase status` — не публикуйте вывод. Для отдельно разрешённого удалённого тестового проекта:

```sh
supabase login
supabase link --project-ref <TEST_PROJECT_REF>
supabase db push --dry-run
# После проверки проекта и отдельного разрешения на применение:
supabase db push
```

Авторизация CLI и пароль БД вводятся локально через безопасный штатный поток, не через git. Не используйте команды удалённого push как шаг автоматической установки.

## Supabase Dashboard (выполняет владелец проекта)

1. Authentication → Providers → Email: включить email/password и **Confirm email**. Настроить подходящую политику паролей (UI требует минимум 8 символов).
2. Authentication → URL Configuration: задать реальный Site URL. В Redirect URLs разрешить точные адреса `<origin>/auth/callback` и `<origin>/auth/update-password` для development, staging и позднее согласованного production origin. Не добавлять широкие wildcard для production.
3. Настроить SMTP, отправителя, шаблоны Confirm signup / Reset password, rate limits и при необходимости CAPTCHA. Шаблоны должны использовать штатную ссылку подтверждения `ConfirmationURL`, чтобы сохранялся redirect flow.
4. Проверить RLS и grants после миграции на тестовом проекте. Не отключать RLS для отладки.

Используется PKCE с `persistSession` и автообновлением Supabase JS. Автоматический `detectSessionInUrl` отключён: provider подписывается на Auth, затем явно обменивает callback `code` через `exchangeCodeForSession`, сохраняя `sb_flow_id` для выбора правильного verifier. URL немедленно очищается; запрос выполняется один раз, в том числе при React Strict Mode. Ошибка URL/обмена обрабатывается до проверки существующей сессии; обычный вход не означает успешное подтверждение ссылки. Форма смены пароля требует `PASSWORD_RECOVERY` от SDK после успешного PKCE-обмена либо такого же проверенного Auth-события в текущем provider. Разрешение связано с user id, живёт только в памяти до 10 минут, проверяется повторно при отправке формы и снимается при успехе, обычном входе, выходе или смене пользователя. Успешный proof одноразовый даже при remount provider. После перезагрузки страницы нужна новая recovery-ссылка; наличие сессии, URL `type=recovery` или посещение `/auth/update-password` не дают доступа к форме. Это защита recovery-интерфейса, а не изменение штатной политики Supabase для самостоятельной смены пароля авторизованным пользователем через API.

Ссылку подтверждения/восстановления нужно открывать в том же браузере, где запросили письмо (там хранится PKCE verifier). Письмо с истёкшей ссылкой запрашивается заново. Email-приглашение в пару автоматически **не отправляется**: участник копирует созданную ссылку и отправляет её партнёру лично.

## Модель безопасности

- Один активный membership на пользователя (partial unique index).
- У пространства два допустимых `seat` (1, 2), partial unique index на активное место. Это технические слоты, **не роли**; оба участника имеют одинаковые права.
- Клиент не может напрямую вставлять/удалять memberships, spaces или invitations либо менять user_id/seat/чужие строки.
- Историю приглашений читает только отправитель, пока остаётся в пространстве; получатель получает минимальные сведения по токену через RPC. Новый партнёр не видит email предыдущих приглашённых.
- Профиль читает владелец и текущий партнёр; изменяет только владелец и только `display_name`/`avatar_url`. Внешние аватары автоматически не загружаются.
- `initialize_profile`, `touch_profile`, `require_verified_user` не имеют EXECUTE для PUBLIC, anon и authenticated. Для слоя Auth/пары семь явно разрешённых функций доступны authenticated: пять business RPC и два RLS-предиката `is_space_member`/`is_partner`. Предикатам нужен EXECUTE при вычислении RLS; они возвращают только boolean относительно текущего `auth.uid()`. Anon не может вызывать ни одну функцию этого этапа. `supabase/tests/privileges.sql` проверяет эффективные привилегии (включая наследование/PUBLIC), security definer и фиксированный search_path.
- SECURITY DEFINER RPC проверяют `auth.uid()` и `email_confirmed_at`, используют фиксированный пустой `search_path` и минимальные EXECUTE grants. Auth email проверяется в `auth.users`, не берётся из параметров клиента.
- Мутации берут advisory lock пользователя, затем row lock пространства. Принятие дополнительно блокирует строку приглашения и проверяет её состояние/срок после блокировки. Уникальные ограничения — дополнительная защита от гонок.
- Ссылка: 244 случайных бита, 24 часа, строго один подтверждённый email. В БД только SHA-256, `token_hash` не доступен клиентским ролям. Новый invite отменяет предыдущие; принятие и отклонение одноразовые.
- Токен передаётся во fragment `/invite#token=…` (не в URL запроса и не в referer), немедленно убирается из адреса и временно сохраняется в sessionStorage до решения. Не копируется в query keys, постоянное хранилище, аналитику или логи. При блокировке sessionStorage UI предлагает разрешить его. Отправитель видит ссылку только при создании; затем нужна новая ссылка.
- Вступление атомарно и добровольно. Нельзя принять за другого или вступить из уже активного пространства. Выход доступен каждому без подтверждения партнёра и отменяет pending invites; последнее покинутое пространство архивируется. История membership остаётся в БД, но не видна обычному клиенту.
- Настройка ролей суперпользователя/service_role вне клиентской модели доверия; эти ключи никогда не должны попадать в браузер.

## Автоматические тесты

```sh
npm run test:unit  # jsdom, UI/Auth SDK contracts
npm run test:db    # реальный disposable PostgreSQL 17 в Docker
npm test          # оба набора; отсутствие Docker считается ошибкой, не skip
```

DB runner сам поднимает `postgres:17-alpine` на случайном loopback-порту с отдельной пустой БД `kolo_test` и удаляет контейнер в finally. Remote URL/credentials не читает, к production подключиться не может. Trust auth включён **только для disposable локального контейнера**. Нужен доступ Docker к Docker Hub при первом pull.

`supabase/tests/bootstrap.sql` предоставляет минимальный контракт Supabase Auth для vanilla PostgreSQL: роли `anon`/`authenticated`, таблицу `auth.users` и `auth.uid()` через claim текущей транзакции. Это **реальная PostgreSQL с RLS и RPC**, а не мок базы; роли тестов без BYPASSRLS. Bootstrap не заменяет GoTrue и никогда не применяется к проекту Supabase. Тестируется сама production-миграция, а не её копия. Параллельные запросы используют разные DB connections. Auth UI тесты используют моки SDK. Дополнительный локальный integration runner проверяет реальные GoTrue, Mailpit, PostgREST и production PKCE handler (см. ниже). Ни один локальный тест не доказывает доставку писем внешним SMTP-провайдером или настройки hosted Dashboard.

Проверки покрывают профиль, изоляцию пар, запрет прямых мутаций и третьего участника, ограничения получателя, истечение/отмену/повторное использование, decline, конкурентное принятие, конкурирующее создание/вступление, самостоятельный выход и гонку выхода со вступлением.

## Обновление типов

`src/lib/database.types.ts` — типизированный снимок публичной схемы этой миграции. После изменения миграций и их применения **к локальной тестовой базе** обновите его через CLI:

```sh
supabase gen types typescript --local --schema public > /tmp/kolo-database.types.ts
# Проверьте diff и затем перенесите в src/lib/database.types.ts.
```

Не заменяйте файл результатом неуспешной команды. Удобные алиасы `Profile`, `CoupleSpace`, `CoupleMember` и `CoupleInvitation` используются UI: после генерации сохраните их как `Database['public']['Tables']['profiles']['Row']` и аналогично для остальных таблиц. Затем выполните typecheck, lint, npm test и build.

## Ручная проверка на тестовом Supabase

Двумя разными браузерными профилями: регистрация → письмо → callback → вход → перезагрузка с восстановлением сессии → редактирование профиля → создание solo-пространства → ссылка на email второго → вход второго → принятие → появление партнёра у обоих (polling до 15 секунд). Отдельно: неверный email получателя, decline, истечение, повторная ссылка, смена пароля по письму, offline/online и выход из аккаунта/пары. После выхода профили бывших партнёров больше не доступны через API. Внешняя доставка писем и hosted Dashboard требуют отдельной ручной проверки. Vanilla PostgreSQL тесты дополняются отдельными локальными Supabase integration-тестами ниже.


## Проверка на настоящем локальном Supabase

`npm run test:supabase -- /tmp/kolo-supabase-status.json` — отдельный opt-in runner для **выделенного disposable local Supabase**, никогда не для рабочего проекта. Нужен Node 24 (нативное выполнение TypeScript для production callback handler). Runner разрешает только loopback API/DB/Mailpit, не читает удалённые credentials, создаёт временных Auth-пользователей и удаляет их в finally. Если схемы ещё нет, применяет миграцию к этой **локальной** базе; существующие роли/auth.users не подменяет, bootstrap.sql не использует. Для настоящей проверки backfill запускайте на свежем локальном проекте.

Пример подготовки отдельной среды вне checkout (воспроизведено с CLI 2.121.0):

```sh
mkdir -p /tmp/kolo-supabase-review
SUPABASE_HOME=/tmp/kolo-supabase-cli npx supabase@2.121.0 init --workdir /tmp/kolo-supabase-review
```

В сгенерированном `/tmp/kolo-supabase-review/supabase/config.toml`: включите `auth.email.enable_confirmations`, задайте additional_redirect_urls `http://127.0.0.1:5173/auth/callback` и `http://127.0.0.1:5173/auth/update-password`, локальные `auth.rate_limit.email_sent = 100` и `auth.email.max_frequency = "0s"` (или выдерживайте заданный интервал между тестовыми письмами). Не переносите тестовые лимиты в production.

```sh
SUPABASE_USE_SLIM_IMAGES=true SUPABASE_HOME=/tmp/kolo-supabase-cli npx supabase@2.121.0 start --workdir /tmp/kolo-supabase-review --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
SUPABASE_HOME=/tmp/kolo-supabase-cli npx supabase@2.121.0 status --workdir /tmp/kolo-supabase-review -o json > /tmp/kolo-supabase-status.json
npm run test:supabase -- /tmp/kolo-supabase-status.json
```

Status-файл содержит **локальные** keys; держите его вне репозитория, не выводите в чат/логи, удалите после проверки. Для npm в cloud при необходимости используйте cache `/tmp/kolo-npm`. Если CLI health check попадает в HTTP proxy, сначала диагностируйте прямой `GET /auth/v1/health`: в текущей среде прямой запрос вернул 200, а встроенный wget из контейнера через proxy — 403. `--ignore-health-check` использовался только для сохранения диагностируемых контейнеров; успешность проверок подтверждена реальными Auth/REST запросами, не кодом выхода CLI.

Проверено на локальных PostgreSQL 17.11, GoTrue v2.197.0, PostgREST v16.4, Mailpit v1.31.3: применение миграции после существующего Auth-пользователя и backfill, Auth signup trigger при ограниченных grants, письмо подтверждения через Mailpit и PKCE callback, JWT/RLS через настоящий REST, запрет внутренних RPC, создание/принятие/выход из пары, recovery email → PASSWORD_RECOVERY → смена пароля → вход новым паролем. Просроченный PKCE проверяется настоящим старением `auth.flow_state` в disposable БД; отдельно проверяются отсутствующий verifier и Auth error redirect. Production handler вызывается напрямую с настоящим SDK/GoTrue, UI-гейты — в jsdom тестах.

После проверки остановите только этот локальный проект:

```sh
SUPABASE_HOME=/tmp/kolo-supabase-cli npx supabase@2.121.0 stop --workdir /tmp/kolo-supabase-review --no-backup
rm /tmp/kolo-supabase-status.json
```

Удалённые Supabase, миграции production, внешний SMTP и hosted Dashboard в рамках этой проверки не изменялись и не проверялись.


## Миграция этапа 3: задания и экономика

После исходной Auth-миграции добавлена `supabase/migrations/20261019170000_tasks_economy.sql`: девять таблиц заданий/согласий/экземпляров/фактов/прогресса/журнала/конфигурации, RLS и атомарные RPC. Она не меняет существующие аккаунты/членство и не начисляет очки за старые демоданные: progress создаётся лениво при первом настоящем выполнении. Исходная Auth-миграция неизменна.

Удалённая база и уже созданная облачная пара **не затрагивались**. После проверки PR применение выполняет владелец отдельно, без повторного создания пользователей. Не запускайте `db reset` для облачной/рабочей базы. Не вводите service_role в браузер.

Порядок для отдельно разрешённого staging:

1. Проверить целевой project ref и резервную копию; убедиться, что Auth-миграция уже применена.
2. `supabase db push --dry-run` должен показывать только непроведённые миграции. Проверить `20261019170000_tasks_economy.sql` и последующую `20261019190000_tasks_security_review.sql`. Review-миграция усиливает completion RLS и использует серверное время после блокировок; публичные сигнатуры/переменные не меняются. Внутренний `task_clock()` не имеет EXECUTE для PUBLIC/anon/authenticated.
3. Только после отдельного разрешения: `supabase db push`. Не применять эту команду автоматически из setup/start scripts или CI.
4. Проверить read-only audits `supabase/tests/privileges.sql` и `task-privileges.sql` через SQL Editor, если этот доступ разрешён. Они не изменяют данные.
5. Обновить DB-типы через штатный CLI по инструкции выше, просмотреть diff, выполнить проверки. Текущий typed snapshot включает новые таблицы/RPC; Insert/Update для клиентских task/economy таблиц намеренно never. SQL grants/RLS остаются источником безопасности независимо от TypeScript.
6. Обновить приложение обычным отдельно согласованным процессом. Новых переменных окружения или Dashboard-настроек для этапа 3 нет: используются прежние URL + publishable key и защищённая сессия.
7. Ручной двухаккаунтный checklist: [tasks-economy.md](tasks-economy.md#ручная-проверка-на-двух-аккаунтах-после-отдельно-согласованной-миграции). Не проверять выход/разрыв рабочей пары без отдельного согласия.

`npm test` применяет **все** миграции по имени к disposable PostgreSQL, сохраняя регрессионные Auth/профиль/пара тесты. Новый audit проверяет EXECUTE/PUBLIC/наследование, RLS и отсутствие прямой записи в totals/journal. SQL-тесты проверяют точные награды, idempotency, гонки, смену периода, сохранность истории при выходе и неизменяемость журнала.

`npm run test:supabase -- <LOCAL_STATUS_JSON>` дополнен настоящими задачами через GoTrue/PostgREST: личное/совместное/повторение/decline, конкурентное выполнение, серверные totals, RLS, запрет правки баланса/журнала и закрытие дел при выходе. Только для отдельного disposable local Supabase с loopback API/DB/Mailpit. Он создаёт/удаляет **только собственные временные локальные** аккаунты, не подключается к существующей облачной паре. При первом запуске на свежем stack применяет все миграции без bootstrap-моков Auth; уже применённые схемы не сбрасывает. Для следующей версии миграции используйте новый disposable stack, а не старый persistent volume.


## Этап 4: магазин и журнал Coins

Новая pending migration — `20261019220000_rewards_store.sql`, **после** `20261019190000_tasks_security_review.sql`. Добавляет reward_offers, reward_offer_consents, reward_purchases, coin_transactions, RLS, публичные RPC создания/согласия/публикации/покупки/исполнения/сводки и внутренние триггеры earn/возврата при выходе. Полная модель, гарантии, ограничения и ручной checklist: [rewards-store.md](rewards-store.md).

Новых переменных окружения, secrets или Dashboard-настроек нет. Миграция зеркалирует существующие личные начисления в earn без изменения балансов; при расхождении балансов с историей останавливается, не исправляя данные автоматически. На время backfill берётся блокировка reward_ledger: применять только в отдельно согласованное окно, сначала проверить dry-run и историю миграций. Не удалять данные, не сбрасывать базу и не трогать существующие облачные аккаунты из тестов. После отдельного разрешения применить только pending migration штатным процессом, затем read-only `store-privileges.sql` audit, обновить типы по инструкции выше и выполнить двухаккаунтный checklist. Это документация, не автоматический шаг setup.

`npm test` проверяет все четыре миграции и backfill на disposable PostgreSQL. Локальный `test:supabase` применяет store migration после настоящих начислений задач, подтверждает отсутствие двойного учёта, JWT/RLS/RPC, согласия, debit/refund, receipt и возврат при выходе. Использует только собственные новые временные локальные аккаунты. Для проверки изменённой миграции нужен новый disposable stack, не remote reset.

Заключительное review PR #4 исправляет пока не применённую удалённо store migration: backfill проверяет объединение ledger/progress владельцев и не переносит нулевые факты в positive-only coin journal. `buy_reward_offer` теперь принимает третий параметр `p_expected_purchases` (integer, default 0) для защиты разных UUID со старого экрана; старый двухаргументный повтор с тем же UUID остаётся идемпотентным, новая повторная покупка требует актуального counter. Типы/UI обновлены. `test:db` последовательно запускает основной security suite и полные migration-тесты на отдельных новых disposable БД; никакой существующий проект не сбрасывается. Если ранняя версия store migration уже была применена вне тестового disposable stack, не запускать файл повторно: потребуется отдельная forward-миграция после согласования владельцем.


## Этап 5: совместные цели

Новая pending migration — `supabase/migrations/20261020090000_couple_goals.sql`, после `20261019220000_rewards_store.sql`. Создаёт семь RLS-таблиц целей/согласий/шагов/назначений/отметок/events/одноразовых бонусов, security-invoker view goal_progress, четыре изменяющих бизнес-RPC, SELECT-only inspect_goal_request и caller-scoped predicates. Существующие миграции, Auth, аккаунты и task/store начисления не меняет. Только подтверждённое достижение через RPC добавляет +50 в space_progress и отдельный goal_reward_ledger одной транзакцией. Coin earning trigger и reward_ledger не затрагиваются.

Новых env/Dashboard-настроек нет. После отдельного разрешения владельца: project ref, backup, `db push --dry-run`, только pending migration, затем read-only `supabase/tests/goal-privileges.sql`, обновление типов по инструкции выше и ручной двухаккаунтный checklist из [couple-goals.md](couple-goals.md). Не сбрасывать базу, не создавать повторно существующие аккаунты и не проверять leave рабочей облачной пары. Ни setup, ни frontend миграцию не применяют.

`npm test` применяет все пять миграций в disposable PostgreSQL, включая регрессии предыдущих этапов. Локальный `test:supabase` проверяет реальные JWT/RLS/view/RPC, согласия/отметки двух пользователей, конкурентное взаимное завершение, однократные +50, неизменные Coins, closure/void при выходе, возвращение того же и нового партнёра. Использует только новые временные локальные Auth-аккаунты и чистит их, без обращения к облачной паре.

Заключительное review PR #5 обновляет только pending `supabase/migrations/20261020090000_couple_goals.sql`; миграции PR #2–#4 не переписываются. Новые параметры create/change: `p_expected_goals`/`p_expected_changes` (integer default 0), исходный fence сохраняется между повторами; same-key replay проверяется раньше fence. `inspect_goal_request(uuid,uuid default null)` — authenticated SELECT-only RPC с проверкой caller, внутренний `protect_goal_reward()` не доступен PUBLIC/anon/authenticated. Актуальные grants проверяются `goal-privileges.sql`, сверка итогов без записи — `together-xp-audit.sql`. Подробности intent, ограничений и immutable guard: [couple-goals.md](couple-goals.md).

Удалённое состояние миграций в этом review не изменялось. Если прежняя версия pending SQL уже была применена кем-либо вне disposable тестовой среды, не переисполняйте изменённый файл и не сбрасывайте базу: потребуется отдельная согласованная forward migration. Новых env/Dashboard-настроек нет.

## Этап 6: достижения и статистика

Новая pending migration **`supabase/migrations/20261020120000_achievements_statistics.sql`**, после goals migration. Создаёт частичные индексы, внутренний invoker facts view, RPC `get_statistics()`, `get_joint_history(jsonb,integer)`, `acknowledge_statistics()`, RLS-таблицы own seen baseline и полностью закрытых history keyset sessions. Старые миграции, балансы и правила начисления не меняются. Исторические факты учитываются вычислением, backfill с начислениями отсутствует. Права read-only проверяет `supabase/tests/statistics-privileges.sql`. Типизированный snapshot обновлён; штатная генерация типов описана выше.

Новых env/Dashboard-настроек нет. После отдельного разрешения: target ref, backup, `db push --dry-run` с проверкой только pending файлов, согласованное окно для транзакционного создания индексов, применение штатным процессом, grants audit и проверки. Удалённый reset/удаление пользователей запрещены. Если ранняя версия этой pending миграции уже кем-либо применена вне disposable среды, потребуется отдельная forward migration, не переисполнение/переписывание применённой истории. Setup/frontend ничего удалённо не применяют.

`npm test` теперь включает stage 6 на disposable PostgreSQL, сохраняя Auth/task/store/goal регрессии. Локальный Supabase runner дополнен JWT/RLS, historical facts, 13 badges, балансом, UTC, keyset и приватностью состава; использует только собственные новые временные локальные аккаунты. Полная модель, TTL/cap cursor sessions, at-most-once поздравления, источники и performance: [achievements-statistics.md](achievements-statistics.md).

## Этап 7: добровольные ритуалы

Новая pending migration: **`supabase/migrations/20261021120000_couple_rituals.sql`**, после `20261020120000_achievements_statistics.sql`. Четыре отдельные RLS-таблицы: couple_rituals, ritual_consents, ritual_instances, ritual_completions. Verified-caller RPC для create/change/resolve/withdraw/refresh/complete, SELECT-only lookup, paginated list/history и summary; private helpers закрыты от browser roles. Composite FK связывает экземпляр с пространством. Экономические таблицы и прежние миграции не меняются.

Новых env/Dashboard-настроек/cron нет. Только после отдельного разрешения: target ref/backup, `db push --dry-run`, проверка только pending файлов, применение штатным процессом, read-only `supabase/tests/ritual-privileges.sql`, обновление typed snapshot по инструкции выше и проверки на специально разрешённой тестовой паре. Не reset и не удалять старых пользователей. Ранняя применённая вне disposable среды версия требует отдельной forward migration.

`npm test` сохраняет прежние регрессии и проверяет настоящие PostgreSQL consent/UTC/locks/replay/leave/RLS и отсутствие любых начислений. `test:supabase` дополнен настоящими JWT/RLS/RPC ритуалов, историей и same/new partner; только новые собственные disposable local аккаунты с проверкой очистки. Подробности модели и ручных проверок: [couple-rituals.md](couple-rituals.md). Удалённая база и production из этой задачи не изменяются.

## Етап 8 — емоційна близькість

Після ритуалів додана лише pending-міграція `20261022120000_emotional_connection.sql`. Дев’ять RLS-таблиць `connection_*`, без економічних backfill чи зміни старих міграцій. Перед новим UI застосуйте її до окремої staging-середи транзакційно за окремим дозволом, перезавантажте PostgREST schema (`NOTIFY pgrst, 'reload schema'`) та виконайте read-only `supabase/tests/connection-privileges.sql`. Нових Dashboard налаштувань чи змінних середовища немає. Свіжі типи: `src/lib/database.types.ts` (RPC JSON contracts) і `src/features/connection/model.ts` (DTO); стандартна команда генерації типів описана вище, не використовуйте service key у frontend.

Звичайні `npm test` включають реальні disposable PostgreSQL перевірки. `npm run test:supabase -- /tmp/OWN-local-status.json` тестує справжні Auth/JWT/PostgREST, нові RPC та приватність, видаляючи тільки власні тимчасові локальні акаунти. Після SQL schema cache може оновлюватися асинхронно: runner очікує read-only readiness, не повторює мутації автоматично. Не запускайте зі статусом cloud або існуючими акаунтами. Архітектура, згода, leave/rejoin, обмеження пагінації та safe rollout: [between-us-card-game.md](between-us-card-game.md).
