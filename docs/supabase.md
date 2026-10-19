# Supabase: Auth, профили и пространство пары

## Границы этапа

Auth и данные профиля/пары используют настоящий Supabase при наличии публичной конфигурации. Без неё включается явно отмеченный деморежим без пользовательской сессии. Задания, начисления, подписки, кошельки и реальные награды не реализованы. В авторизованном режиме разделы будущих функций показывают состояния ожидания, а не демоданные под видом реальных данных.

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
- `initialize_profile`, `touch_profile`, `require_verified_user` не имеют EXECUTE для PUBLIC, anon и authenticated. Только семь явно разрешённых функций доступны authenticated: пять business RPC и два RLS-предиката `is_space_member`/`is_partner`. Предикатам нужен EXECUTE при вычислении RLS; они возвращают только boolean относительно текущего `auth.uid()`. Anon не может вызывать ни одну функцию этого этапа. `supabase/tests/privileges.sql` проверяет эффективные привилегии (включая наследование/PUBLIC), security definer и фиксированный search_path.
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
