# P2P Ledger — стартовий репозиторій

Це стартовий каркас для тестового завдання (`ТЗ_тестове_завдання_6`). Частина
сервісів уже працює, частина — лише каркас або TODO. Повний опис завдання —
у файлі ТЗ, який ви отримали окремо.

## Що вже працює

- `apps/ledger-service` — автентифікація (register/login/refresh) і базовий
  CRUD гаманців. Балансу гаманця бракує event sourcing — це частина завдання.
- `apps/frontend` — логін/реєстрація, live-гаманці, переказ із прогресом саги,
  split-рахунки, активність із фільтром та адмінка (Next.js App Router через BFF).
- `apps/notifications-service` — Redis Streams-консюмер, персональна стрічка
  активності та Socket.IO-сповіщення; власна БД з міграціями.

## Запуск

```bash
docker-compose up --build
```

- ledger-service: http://localhost:3001
- payments-service: http://localhost:3002
- notifications-service: http://localhost:3003
- bff: http://localhost:3004 (Swagger: http://localhost:3004/docs)
- frontend: http://localhost:3000

Схема БД ledger створюється міграціями (`apps/ledger-service/src/migrations`),
вони застосовуються автоматично на старті сервісу; `synchronize` вимкнено.
Міграції даних зі стартової схеми (баланс полем у `wallets`) немає — БД
лише для розробки, тому том зі старою схемою треба перестворити:
`docker compose down -v`.

Swagger ledger-service — http://localhost:3001/docs. Адмін створюється на
старті з `ADMIN_EMAIL` / `ADMIN_PASSWORD` (`apps/ledger-service/.env.example`);
роль admin має лише цей акаунт — після зміни `ADMIN_EMAIL` попередній адмін
стає звичайним користувачем. Адмін-ендпоінти — `/admin/*` (event-лог гаманця,
reconciliation, freeze). Заморожений гаманець не приймає й не віддає гроші
(deposit, withdraw, новий холд, зарахування переказу й списання холду на
користь отримувача → 409); холд на ньому можна лише зняти (компенсація саги).
Міжвалютне зарахування (`POST /internal/holds/:id/capture`) приймається, лише
якщо сума = сума холду × `fxRate` з точністю до однієї мінорної одиниці.
`POST /internal/holds/:id/release` приймає необов'язковий `walletId` гаманця
відправника. Для холду, якого ще немає (запит `POST /internal/holds` застряг, а
сага вже здалась і знімає холд), release блокує цей гаманець і лишає слід в
`operations`; запізнілий холд з тим самим `holdId` отримає `409 HOLD_NOT_ACTIVE`,
тож кошти не лишаються в `held` без власника. `walletId`, що не збігається з
гаманцем наявного холду, → `400`. Без `walletId` невідомий холд, як і раніше, → `404`.
Звірку можна запустити й скриптом: `docker compose exec ledger-service npm run reconcile`
(код виходу 1 — є розбіжності).

Для локальної розробки без Docker: скопіюйте `.env.example` → `.env` у
кожному сервісі, підніміть Postgres окремо, `npm install && npm run start:dev`
у потрібному сервісі.

## Сага переказу (payments-service)

`POST /transfers` (JWT + обов'язковий заголовок `Idempotency-Key`, 1–128 символів) лише створює переказ у статусі `PENDING` і відповідає `202`; далі його веде фоновий saga runner. Статус — `GET /transfers/:id`: відправник бачить переказ завжди, отримувач — лише після зарахування (`COMPLETED`; невдалі й незавершені перекази його не стосуються), іншим — 404; список — `GET /transfers?limit=`. Swagger — http://localhost:3002/docs.

- **Оркестрація.** Координатор — payments-service, стан саги — рядок `transfers` (`status` + `step`). Кроки: `RISK_CHECK` (ліміт `TRANSFER_MAX_AMOUNT`, чорний список `BLOCKED_EMAILS`) → `RESOLVE_RECIPIENT` (користувач за email, переказ собі відхиляється за `userId`, і його гаманець у валюті зарахування, створюється за потреби) → `FX_QUOTE` (курс з кешу, сума зарахування округлюється вниз) → `HOLD` → `CONFIRM` (курс не старший `FX_MAX_QUOTE_AGE_MS`, отримувач не заморожений) → `CAPTURE` (списання з холду й зарахування отримувачу — одна транзакція в ledger).
- **Компенсація.** Відмова до холду → `FAILED`, відкочувати нічого. Відмова на `CONFIRM`/`CAPTURE` → `COMPENSATING` → `RELEASE_HOLD` (кошти повертаються в available, ledger пише `TransferFailed`) → `FAILED`. Компенсація повторюється, доки ledger її не прийме. Release передає гаманець відправника (`walletId`): якщо запит на холд застряг і ledger його ще не бачив, release під блокуванням гаманця лишає слід (запис в `operations`), і запізнілий холд отримує `409 HOLD_NOT_ACTIVE` замість того, щоб назавжди зависнути в `held`. Якщо ledger відповідає на release `HOLD_NOT_ACTIVE` або `422 IDEMPOTENCY_KEY_REUSED` (release з цим `operationId` уже виконано з іншим тілом), результат компенсації визначає стан холду: `CAPTURED` → `COMPLETED`, `RELEASED` чи холду немає → `FAILED`.
- **Невизначений результат** (5xx, таймаут, відкритий circuit breaker) — не відмова: `AWAITING_RETRY` з exponential backoff, той самий крок з тим самим `operationId` (`transfer:<id>:<крок>`), тож у ledger він виконується один раз. Після `SAGA_MAX_ATTEMPTS` кроки до холду → `FAILED`, `HOLD`/`CONFIRM` → компенсація. `CAPTURE` ніколи не компенсується наосліп: після вичерпання спроб runner питає стан холду (`CAPTURED` → `COMPLETED`, `ACTIVE` → компенсація), а поки ledger недоступний — чекає далі.
- **Застряглі саги.** Runner бере переказ під lease (`locked_until` = `SAGA_STEP_TIMEOUT_MS`) короткою транзакцією з `FOR UPDATE SKIP LOCKED`; HTTP-виклик іде поза транзакцією, результат фіксується окремою транзакцією разом з outbox. Процес упав посеред кроку — lease протухає, і переказ підхоплює інший runner; запізнілий результат старого runner'а відкидається. Тік runner'а чекає всі перекази пачки (`Promise.allSettled`), а circuit breaker зупиняється вже після нього (`onApplicationShutdown`), тож крок, що виконується на SIGTERM, не втрачає ledger. Обмеження: новий тік не стартує, поки найповільніший переказ пачки не завершився; для більшого навантаження варто було б брати нові перекази, щойно звільнюється слот (пул воркерів) — тут цього не робили.
- **Circuit breaker** (`opossum`) на всіх викликах ledger: поки ledger лежить, виклики одразу завершуються помилкою, і сага переходить в `AWAITING_RETRY`, а не висить. Остаточні відмови ledger (4xx з кодом) breaker не рахує як збої.
- **Ідемпотентність.** `UNIQUE(sender_user_id, idempotency_key)` + `INSERT … ON CONFLICT DO NOTHING`: паралельні дублі чекають на коміт першого запиту й отримують той самий переказ (`200`); той самий ключ з іншим тілом → `422 IDEMPOTENCY_KEY_REUSED`.
- **Події.** Кожна зміна `status`/`step` пише в outbox `TransferStatusChanged` у тій самій транзакції; relay публікує їх у `stream:payments-events`.
- **Rate limit** на `POST /transfers` — за `userId` з JWT (`TRANSFER_RATE_LIMIT` за `TRANSFER_RATE_TTL_MS`).
- Одержувач — лише email: username в auth-модулі немає, а auth не розширюємо.
- `TRANSFER_MAX_AMOUNT` — спрощене мок-правило: одне число в одиницях валюти переказу для всіх валют.
- Env payments-service валідується на старті (`ConfigModule.forRoot({ validate })`): без обов'язкових змінних сервіс не стартує. Пов'язані таймаути звіряються: `FX_CACHE_TTL_MS < FX_MAX_QUOTE_AGE_MS` (інакше курс із кешу міг би застаріти до кроку `CONFIRM`) і `CB_TIMEOUT_MS < SAGA_STEP_TIMEOUT_MS` (інакше lease кроку спливав би посеред виклику ledger).
- Переказ собі: ledger розрізняє email за регістром (`Bob@x.com` і `bob@x.com` — різні акаунти), тому порівняння рядків у `RISK_CHECK` прибрано: збіг визначає `RESOLVE_RECIPIENT` за `userId`. Чорний список порівнюється без урахування регістру.

Приклад (стек запущено `docker compose up --build`; `ACCESS`, `WALLET` — токен і USD-гаманець відправника з ledger, у гаманці є кошти; отримувач `bob@example.com` зареєстрований):

```bash
curl -s -X POST http://localhost:3002/transfers \
  -H "Authorization: Bearer $ACCESS" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d "{\"fromWalletId\":\"$WALLET\",\"toWalletIdentifier\":\"bob@example.com\",\"amount\":10,\"currency\":\"USD\",\"toCurrency\":\"EUR\"}"
```

## Split-рахунки (payments-service)

Ініціатор створює груповий рахунок: загальна сума, валюта, учасники (за email) і частки. Кожен учасник підтверджує свою частку й сплачує її окремим переказом на email ініціатора — тією самою сагою, що й звичайний переказ. Swagger — http://localhost:3002/docs.

- `POST /split-bills` `{ title, totalAmount, currency, mode, participants: [{ email, amount? }], dueAt? }` + необов'язковий `Idempotency-Key` → `201`; повтор з тим самим ключем — `200` і той самий рахунок (без дубліка й другої події), той самий ключ з іншим тілом — `422 IDEMPOTENCY_KEY_REUSED`; без ключа кожен запит створює новий рахунок (ключ необов'язковий, бо створення рахунку — мутація без чутливості до реального часу, яку фронтенд викликає Server Action'ом). `mode: EQUAL` — порівну, залишок мінорних одиниць (копійок) отримує перший учасник (100.00 / 3 → 33.34, 33.33, 33.33); `CUSTOM` — суму кожного задає ініціатор, їх сума має дорівнювати `totalAmount`, інакше `400 SHARES_SUM_MISMATCH`. До 20 учасників; учасник — зареєстрований користувач (інакше `400 PARTICIPANT_NOT_FOUND`), без повторів. Кожна частка має вкладатись у `TRANSFER_MAX_AMOUNT` (`400 SHARE_LIMIT_EXCEEDED`), а ініціатор і учасники не можуть бути в `BLOCKED_EMAILS` (`400 BLOCKED_PARTICIPANT`): інакше частку неможливо було б сплатити, і рахунок ніколи не став би `SETTLED`. **Ініціатор не може бути учасником** (`SELF_PARTICIPANT`): його частка була б переказом самому собі, а сага такі перекази відхиляє (`SELF_TRANSFER`).
- `GET /split-bills`, `GET /split-bills/:id` — рахунок бачать ініціатор і учасники, іншим — `404`.
- `POST /split-bills/:id/shares/:shareId/accept` — учасник підтверджує свою частку (`PENDING → ACCEPTED`); чужа частка → `404`, повторне підтвердження → `409`.
- `POST /split-bills/:id/shares/:shareId/pay` `{ fromWalletId }` + `Idempotency-Key` — створює переказ-оплату (`202`, повтор з тим самим ключем — `200` і той самий переказ; повтор віддається з БД без звернення до ledger, тож працює, навіть поки ledger недоступний). Лише для `ACCEPTED`: без `accept` → `409`. Гаманець має належати платнику (інакше `404`) і бути у валюті рахунку (`400 CURRENCY_MISMATCH`) — так не потрібна зворотна конвертація суми. Rate limit — той самий, що й на `POST /transfers` (за `userId`).
- **Статуси.** Частка: `PENDING → ACCEPTED → PAYING → PAID`; якщо переказ завершився `FAILED`, частка повертається в `ACCEPTED` і її можна сплатити знову. Статус рахунку не зберігається, а виводиться з часток: жодної `PAID` — `PENDING`, частина — `PARTIALLY_PAID`, усі — `SETTLED` (`ACCEPTED`/`PAYING` його не змінюють — гроші ще не надійшли).
- **Без подвійної оплати.** Переказ вставляється першим, потім умовний `UPDATE split_shares … WHERE status = 'ACCEPTED'` у тій самій транзакції. Два паралельні `pay` з **різними** ключами: другий програє `UPDATE` → `409`, і його переказ відкочується разом з транзакцією. З **однаковими** ключами — один переказ (`ON CONFLICT`). Хеш запиту включає частку, тож ключ звичайного переказу не можна повторно використати для оплати частки (`422`). Перехід частки при фіналі саги (`COMPLETED → PAID`, `FAILED → ACCEPTED`) виконується в тій самій транзакції, що й фінальний статус переказу.
- **Прострочені частки.** `dueAt` (необов'язковий, у майбутньому) — термін оплати рахунку, дата або дата-час ISO 8601 (`2026-12-31`, `2026-12-31T18:00:00Z`); неіснуюча дата (`2026-02-31`) чи тижневий/порядковий формат (`2026-W45`) → `400`. Воркер `split-overdue` (`@nestjs/schedule`, `FOR UPDATE SKIP LOCKED`) для часток у `PENDING`/`ACCEPTED` після терміну пише в outbox `SplitShareOverdue` (адресат — власник частки), але не частіше ніж раз на `SPLIT_REMINDER_INTERVAL_MS` на частку (`last_reminded_at`). Частка в `PAYING` не нагадується. Рахунок без `dueAt` ніколи не прострочується.
- **Події.** `SplitBillCreated` (учасникам, у тій самій транзакції, що й рахунок) і `SplitShareOverdue` йдуть через outbox у `stream:payments-events`; оплата частки видна як `TransferStatusChanged`.

## Сповіщення (notifications-service)

Сервіс читає `stream:ledger-events` і `stream:payments-events` у consumer group
`notifications`. `processed_events.event_id` запобігає повторній обробці:
маркер і рядки `activity` комітяться однією транзакцією, потім відправляються
push-події та `XACK`. Якщо процес упав до ACK, `XAUTOCLAIM` підбирає повідомлення
після `CONSUMER_CLAIM_IDLE_MS`. Ім'я консюмера за замовчуванням — hostname і pid;
явний `CONSUMER_NAME` має бути унікальним для кожного процесу.

Невідомі типи підтверджуються з попередженням у логах. Відомий тип із версією
вище підтримуваної одразу потрапляє у `stream:dead-letter`; помилки обробки —
після `CONSUMER_MAX_DELIVERIES` невдалих доставок. Запис у DLQ і ACK атомарні.
DLQ містить `sourceStream`, `sourceId`, `reason`, `fields` (JSON початкових полів);
перегляд: `docker compose exec redis redis-cli XRANGE stream:dead-letter - +`.

`GET :3003/activity?type=DEPOSIT&limit=50` потребує Bearer access JWT і повертає
лише активність власника токена, від нової до старої. Ліміт — 1–100, типи:
`DEPOSIT`, `WITHDRAWAL`, `TRANSFER_SENT`, `TRANSFER_RECEIVED`, `TRANSFER_FAILED`,
`SPLIT_BILL`, `SPLIT_REMINDER`. Swagger — `http://localhost:3003/docs`.

Socket.IO: namespace `/ws`, `auth: { token: accessToken }`, кімната
`user:<userId>` визначається сервером після перевірки JWT у middleware.
`CORS_ORIGIN` задає дозволений origin для HTTP і Socket.IO (локально
`http://localhost:3000`). Події сервера:

- `wallet.balance` — `{ walletId, currency, balance, available, held }` із подій
  ledger; `balance` — сума available і held, без арифметики з float.
- `transfer.status` — `{ transferId, status, step, failureReason? }`; проміжні
  стани бачить лише відправник, завершений переказ — також отримувач.
- `activity.created` — збережений рядок стрічки. Deposit/withdraw походять із
  ledger, фінальні перекази й split-події — з payments, тому переказ не дублюється
  через одночасні події обох сервісів. Учасник split бачить лише свою частку.

Доставка через брокер — at-least-once, запис activity — ідемпотентний. Push після
коміту може бути пропущений при падінні процесу: клієнт **на кожен `connect`**
має перечитати гаманці, поточний переказ і стрічку через REST. Сервер не робить
replay через WebSocket. Socket.IO використовує локальні кімнати одного процесу;
горизонтальне масштабування WS потребуватиме спільного адаптера кімнат.
Redis Streams обмежені утримуваною історією продюсерів (`MAXLEN ~`), тож тривала
зупинка консюмера понад цю історію потребуватиме окремого відновлення.

## Спостережуваність

Кожен Nest-сервіс завантажує `src/tracing.ts` першим імпортом; він спочатку
читає локальний `.env` через dotenv (змінні процесу мають пріоритет), до HTTP, ORM,
Redis і Pino. OpenTelemetry NodeSDK експортує span-и через OTLP HTTP у Jaeger.
У compose використано `jaegertracing/jaeger:2.8.0` в all-in-one режимі;
[Jaeger UI](http://localhost:16686) доступний після `docker compose up --build`.
Сховище трасувань у пам'яті: перезапуск Jaeger їх видаляє.

`OTEL_SERVICE_NAME` визначає сервіс, `OTEL_EXPORTER_OTLP_ENDPOINT` — базову
адресу колектора (`http://jaeger:4318` у compose, `http://localhost:4318` при
локальному запуску). SDK додає `/v1/traces`. `LOG_LEVEL` керує рівнем JSON-логів
nestjs-pino. У кожному рядку є `trace_id`/`span_id`; поза активним span-ом вони
`null` (наприклад, під час запуску). Заголовки авторизації, cookie та внутрішній
токен маскуються. Pino instrumentation корелює логи, а окремого OTLP-експорту
логів немає. SDK завершує експорт після зупинки фонових воркерів.

Контекст запиту зберігається у `transfers.traceparent` і outbox. Кожна спроба
кроку саги — `saga.step <STEP>` з атрибутом `transfer.id`; ретраї лишаються в
тому самому trace. Relay відновлює контекст рядка, створює `publish <type>`
(PRODUCER) і записує його контекст у поля Redis Stream та конверт події.
Notifications відкриває дочірній `process <type>` (CONSUMER), усередині якого
виконує транзакцію, Socket.IO emit і ACK. Повторна доставка має окремий span
у тому самому trace, а дедуплікація залишається за `eventId`. HTTP, Express,
Nest, PostgreSQL, ioredis і Socket.IO інструментуються автоматично; фонові
опитування БД/Redis без активного батька не створюють зайвих трасувань.

Для перевірки створіть переказ за прикладом вище, у Jaeger оберіть
`payments-service` і знайдіть trace з `transfer.id` або HTTP `POST /transfers`.
У ньому мають бути `saga.step *`, HTTP-виклики `ledger-service`,
`publish TransferStatusChanged` / `process TransferStatusChanged` та span-и
notifications/Socket.IO. Відмовлений переказ також має лишатися одним trace.
Перевірена назва кореневої HTTP-операції — `POST /transfers`; запит до Jaeger:
`/api/traces?service=payments-service&operation=POST%20%2Ftransfers&limit=10`.
BFF надає захищений доступ до трасувань через `GET /admin/traces`.

Публічний `GET /metrics` на портах 3001, 3002, 3003 повертає Prometheus text
format: стандартні метрики процесу й Node.js. Payments додатково віддає:

- `transfers_total{status="COMPLETED"|"FAILED"}` — кількість успішно
  зафіксованих фінальних переходів у цьому процесі; втрата lease чи rollback
  не збільшують лічильник;
- `saga_step_duration_seconds{step}` — гістограму тривалості кожної спроби
  кроку разом із фіксацією результату, включно з ретраями й помилками.

Метрики скидаються при перезапуску процесу; вони не замінюють фінансовий аудит
у БД. Тривалість окремого кроку для admin-екрана береться зі span-ів Jaeger.

## BFF (`apps/bff`)

NestJS REST BFF на порту 3004 проксує лише явні публічні маршрути:
`/auth/register|login|refresh`, `/wallets` і операції гаманця — до ledger;
`/transfers` та `/split-bills` із accept/pay — до payments; `/activity` — до
notifications; admin event-лог, reconciliation і freeze — до ledger.
Внутрішні маршрути сервісів через BFF недоступні. JWT перевіряється в BFF
і повторно в сервісі-власнику; `/admin/*` вимагає роль admin. Auth, health,
metrics і Swagger доступні без access JWT. Мутації мають власні DTO,
class-validator і whitelist; перевірка власності та бізнес-правила лишаються
у сервісі-власнику. Rate limiting також виконується там за email/userId.
`Authorization` та `Idempotency-Key` передаються без зміни значення.
Статус і JSON-тіло upstream збережено, зокрема 202/200 для нового/повторного
переказу, 422 для іншого тіла з тим самим ключем і 429 із `Retry-After`.
Виклики не повторюються автоматично, таймаут — 2500 мс; мережева помилка
дає 503. Переадресації upstream не виконуються.

`GET /dashboard` паралельно читає гаманці, 10 останніх переказів і 10 записів
активності. Кожна секція (`wallets`, `transfers`, `activity`) має або
`{ data: [...] }`, або `{ error: { statusCode, message } }`. Недоступність
одного джерела не прибирає решту: агрегат повертає 200 з частковими даними.

`GET /admin/traces?limit=10` (1–100) читає Jaeger Query API з перевіреною
операцією `POST /transfers` і `service=payments-service`. Відповідь — масив
`{ traceId, spans: [{ spanId, operationName, startTime, durationMs, transferId }] }`.
Включено лише `saga.step *` payments, у часовому порядку; повторні спроби
збережено окремо. `startTime` — мікросекунди Unix з Jaeger, `durationMs` —
тривалість span у мілісекундах (не різниця між часом сусідніх кроків).
Без трас — порожній масив; недоступний Jaeger — 503. JWT користувача до
Jaeger не передається.

Конфігурація — `ConfigService` і валідація env на старті. Tracing SDK
завантажує `.env` до інструментації HTTP і pino; OTLP експортується в Jaeger.
Логи — JSON із `trace_id`/`span_id` та маскуванням секретних заголовків.
`/metrics` віддає стандартні метрики Node/процесу в окремому Registry.
`/health` через Terminus показує готовність самого BFF: власної БД і Redis
в нього немає, відмова джерел відображається в dashboard. На SIGTERM SDK
експортує останні span-и. Compose додає BFF з очікуванням healthy upstream,
CI — окремий job із lint, типізацією, unit, HTTP e2e й build.
Наявні сторінки frontend і його конфігурація ще використовують попередні
прямі виклики сервісів.

Перевірки BFF: `cd apps/bff && npm ci && npm run lint && npx tsc --noEmit &&
npm test && npm run test:e2e && npm run build`. HTTP e2e запускають справжній
Nest-застосунок і локальні HTTP-двійники upstream без Postgres/Redis;
перевіряють маршрути, заголовки, DTO, JWT/admin, часткову відмову та таймаут,
Jaeger-перетворення, health/metrics/Swagger. Unit перевіряє env; окремий
процес перевіряє OTLP за конфігурацією лише з `.env`. Попередні тести не змінено.

## Тести

```bash
cd apps/ledger-service && npm test
cd apps/payments-service && npm test
cd apps/notifications-service && npm test
```

Інтеграційні тести payments (`apps/payments-service/test/e2e`) ходять у реальний Postgres на окремій БД `payments_e2e`; ledger у них підміняє HTTP-двійник internal API (`fake-ledger.ts`) — у кожного сервісу своя БД, тож справжній ledger тут не піднімається:

```bash
docker compose up -d payments-db redis
docker compose exec payments-db createdb -U payments payments_e2e
cd apps/payments-service && npm run test:e2e
```

Інтеграційні тести notifications використовують реальні Postgres, Redis, HTTP і
Socket.IO. Для них потрібні окрема БД `notifications_e2e` та окремий Redis на
6380: тести перевіряють consumer group і pending-повідомлення та не повинні
конкурувати з локальним застосунком. У CI кожен job має власні Postgres/Redis.

```bash
docker compose up -d notifications-db
docker compose exec notifications-db createdb -U notifications notifications_e2e
docker run --rm -d --name p2p-notifications-test-redis -p 127.0.0.1:6380:6379 redis:7-alpine
cd apps/notifications-service && npm run test:e2e
# Після тестів:
docker stop p2p-notifications-test-redis
```

Не всі тести в репозиторії однаково надійні — це навмисно, дивись ТЗ.

## Знайдені проблеми стартового коду

> Чорновик: розділ буде доповнено в міру виправлення решти проблем.

Кожна проблема з першої частини таблиці відтворена тестом, який **червоний до виправлення** і зелений після. У git це пари комітів (перший — тест, другий — виправлення), а не «один коміт на все»:

| Проблема | Червоний тест → виправлення |
|---|---|
| Подвійна витрата й lost update | `80a66d4` → `4ba7c94` (`9583e13` — перша версія тесту, частково червона через `ECONNRESET` самого хелпера) |
| Чужий гаманець доступний; не валідується `:id` і `amount` | `f374002` → `00728ee` |
| Суми на кшталт `1e-7` давали 500 (`maxDecimalPlaces` кидає `TypeError`) | `24417a7` → `7ba0722` |
| `POST /wallets` — гонка, дублікати гаманця | `d8679ba` → `a049d00` |
| Тест овердрафту проходить «випадково» | `f49cdbf` (тест і є виправленням; доказ мутацією нижче) |

Проблеми зі старту проєкту, CI і фронтенду автотестів не мають — їх перевірено вручну (запущений стек / `docker compose up --build` / CI). Дві проблеми архітектурного характеру закриваються пізніше (позначені в таблиці). E2E-тести ходять у реальний Postgres через HTTP (`apps/ledger-service/test/e2e`), тому переживуть подальший рефакторинг ledger без змін.

| Проблема | Категорія ТЗ | Суть | Як знайдено / чим відтворено | Виправлення |
|---|---|---|---|---|
| Подвійна витрата й lost update | конкурентний доступ | `withdraw`/`deposit` читають баланс, рахують у JS (`Number`) і зберігають без транзакції та блокування | `wallets-concurrency.e2e-spec.ts`: 20 паралельних `withdraw(10)` зі 100 — на старті всі 20 дають 201; 20 паралельних `deposit(10)` лишають 20–40 замість 200 | транзакція + `pessimistic_write` на рядок гаманця, арифметика в SQL над `numeric` |
| Чужий гаманець доступний (IDOR) | авторизація | `GET/deposit/withdraw` по `:id` не звіряють власника → будь-який користувач бачить, поповнює й списує чужий гаманець | `wallets-access.e2e-spec.ts`: користувач B на гаманець A — на старті 200/201 | сервіс приймає `userId` і шукає `{ id, ownerId }`; чужий гаманець → 404 (не розкриваємо існування) |
| Не валідуються `:id` і `amount` | валідація | `:id` не перевіряється як UUID (500 від Postgres); `amount` без перевірки знаків після коми (0.001 → гроші «зникають» через `toFixed(2)`) і без верхньої межі (переповнення `numeric(18,2)` → 500) | `wallets-access.e2e-spec.ts` | `ParseUUIDPipe`; власний декоратор `@IsMoneyAmount` (додатне, ≤ 1 000 000, ≤ 2 знаки). Штатний `@IsNumber({ maxDecimalPlaces })` не підійшов: на `1e-7` він сам кидає `TypeError` → 500 |
| Тест овердрафту проходить «випадково» | тест | у тесті проміс не `await`-ається й немає `expect.assertions` → зелений навіть без перевірки в сервісі | мутація на коміті `f49cdbf`: прибрати `if (current < amount)` у `withdraw` — старий тест лишається зеленим, новий — червоний («Received promise resolved instead of rejected») | `await expect(...).rejects.toBeInstanceOf(BadRequestException)`, `expect.assertions`, перевірка, що запису не було (після переходу на транзакцію аналог мутації — прибрати `if (!sufficient)`) |
| `POST /wallets`: дублікати гаманця | конкурентний доступ | `findOne` → `save` без UNIQUE → паралельні виклики створюють кілька гаманців однієї валюти, далі `findOne` повертає довільний | `wallets-concurrency.e2e-spec.ts`: 10 паралельних запитів → 10 гаманців | `UNIQUE(ownerId, currency)` + `INSERT … ON CONFLICT DO NOTHING` |
| Сторінка гаманців завжди 401 | фронтенд | `lib/api.ts` не передає `Authorization`, кука `accessToken` ніде не читається → `/wallets` завжди «Ledger API 401» | запущений стек: `GET /wallets` після логіну | `ledgerFetch` читає токен з `cookies()`. Токен живе `JWT_ACCESS_TTL` (15 хв); після спливу сторінка знову покаже 401, бо оновлення токена (refresh) на фронтенді ще не реалізоване |
| CI червоний | CI | `cache: npm` без lockfile, `jest` у payments без тестів → exit 1 | перший запуск CI | lockfiles у всіх сервісах; `jest --passWithNoTests` у payments і notifications прибрано після додавання тестів |
| `payments-service` без авторизації | авторизація | `TransfersController` без JWT-guard, `GET /transfers/:id` без перевірки власника | огляд коду | JWT-guard на всьому контролері; переказ бачать лише відправник і отримувач (іншим — 404); списати з чужого гаманця не можна — ledger звіряє власника при холді (`OWNER_MISMATCH`). Тести: `transfers.e2e-spec.ts` |
| Ledger змішаний з auth через ORM-зв'язок | архітектура | зв'язок `User` ↔ `Wallet` змішує auth-контекст з ledger | огляд коду | зв'язок прибрано: гаманець знає лише `ownerId` (без FK на `users`), баланс — проєкція подій з event store |
| Ledger не стартує проти Postgres | старт сервісу | `User.refreshTokenHash: string \| null` без явного типу колонки → `DataTypeNotSupportedError` (unit-тести мокають репозиторій і цього не бачать) | `docker compose up --build` | `@Column({ type: 'varchar', nullable: true })` |
| Образ ledger не запускається | збірка | у `tsconfig.json` немає `include`, а в ledger є `test/` → вихід у `dist/src/main.js`, а образ запускає `node dist/main` | `docker compose up --build` | `tsconfig.build.json` без `test` |
| Хостові `node_modules` потрапляють в образ | Docker | немає `.dockerignore`: `COPY . .` затирає `node_modules` образу хостовими — натівний `bcrypt` з macOS у Linux-образі дає `Exec format error` | зібрати образ без `.dockerignore` після локального `npm install` | `.dockerignore` (`node_modules`, `dist`, `.env`) у сервісах |

### Змінені стартові тести

`apps/ledger-service/test/wallets.service.spec.ts`:
- Тест овердрафту переписано (див. вище).
- Баланс більше не поле гаманця, а проєкція подій: сервіс пише подію в event store і оновлює проєкцію в одній транзакції. Тому моки репозиторію замінено на мок `EntityManager` (транзакція; рядок проєкції блокується спільним для всіх команд ledger `SELECT … FOR UPDATE` через `find`) і `EventStore`. Збережено ті самі перевірки поведінки, що й у стартовому тесті: депозит збільшує баланс (і пише подію `MoneyDeposited` зі збалансованими проводками, оновлює проєкцію під блокуванням рядка); зняття понад баланс → `BadRequestException`, і нічого не записано (ні події, ні проєкції, ні outbox); чужий гаманець шукається за парою `{ id, ownerId }` і дає `NotFoundException`. Наскрізну арифметику балансу проти реального Postgres перевіряють e2e (`wallets.e2e-spec.ts`), які під час переходу на event sourcing не змінювались.

`npm test` у ledger не запускає `test/e2e`; e2e — окремо, на власній БД `ledger_e2e` (не на робочій `ledger`, з якою працює `docker compose up`):

```bash
docker compose up -d ledger-db redis
docker compose exec ledger-db createdb -U ledger ledger_e2e
cd apps/ledger-service && npm run test:e2e
```

Звірка в e2e перевіряє всю БД, тож запускати їх варто на чистій базі (у CI вона щоразу нова; там БД задається через `DATABASE_NAME`).

### Змінений стартовий код ledger-service

- `auth.controller.ts` — на `POST /auth/login` додано `LoginThrottlerGuard` (ТЗ: rate limiting на логін). Ліміт рахується за email, а не за IP: усі запити до сервісу приходять через один BFF. Сам `AuthService` не змінювався.
- `health` — крім БД показує стан Redis (стрім подій для інших сервісів). Недоступний Redis — деградація (`redis: down` у відповіді), а не відмова: запис у ledger від нього не залежить, події чекають в outbox, і relay не публікує, доки Redis не повернеться. `docker-compose.yml`: ledger-service на старті чекає на здоровий `redis`.
- `main.ts` — Swagger на `/docs` і `enableShutdownHooks()` (фоновий outbox relay зупиняється коректно); `nest-cli.json` — плагін `@nestjs/swagger` (опис DTO без ручних декораторів).
- Публічний контракт гаманців розширено: відповіді гаманця містять ті самі поля, що й у стартері (`balance` рядком), плюс `available`, `held`, `frozen`. **Зміна семантики:** `balance` = `available` + `held` — утримані під переказ кошти ще належать власнику, але витратити їх не можна, тож `withdraw` понад `available` дає 400, навіть якщо сума не перевищує `balance`. `deposit`/`withdraw` приймають опційний заголовок `Idempotency-Key` (повтор → той самий результат, той самий ключ з іншим тілом → 422 `IDEMPOTENCY_KEY_REUSED`); операції із замороженим гаманцем → 409 `WALLET_FROZEN`.

### Змінений стартовий код payments-service

- `transfers.controller.ts`, `transfers.service.ts` — каркас замінено реалізацією саги (див. «Сага переказу»); `GET /transfers/:id` отримав `ParseUUIDPipe` і перевірку доступу, додано `GET /transfers`.
- `create-transfer.dto.ts` — `toWalletIdentifier` тепер `@IsEmail()` (лише email); `amount` — `@IsMoneyAmount` (додатне, ≤ 1 000 000, ≤ 2 знаки, як у ledger); `currency` — одна з `USD`/`EUR`/`UAH`; додано опційне `toCurrency`. Ключ ідемпотентності — заголовком `Idempotency-Key`, а не полем тіла.
- `app.module.ts` — валідація env, TypeORM з міграціями, планувальник фонових задач, throttler; `main.ts` — Swagger на `/docs` і `enableShutdownHooks()` (saga runner і outbox relay завершуються коректно); `nest-cli.json` — плагін `@nestjs/swagger`.
- `health` — перевіряє БД і стан Redis (як у ledger: недоступний Redis — деградація, а не відмова).
- `package.json` — `npm test` без `--passWithNoTests`, додано `test:e2e` і скрипти міграцій; `npm test` не запускає `test/e2e`.
- `.env.example` — нові змінні саги, нагадувань split-рахунків, БД і Redis. `docker-compose.yml`: payments-service чекає на здорові `payments-db` і `redis` (на ledger — як і раніше, лише старт контейнера: недоступний ledger сага пережидає ретраями). CI: для payments піднімаються Postgres і Redis, запускаються e2e.

### Змінений стартовий код notifications-service

- `app.module.ts` — підключення власної БД через TypeORM, міграції замість
  synchronize, валідація env через ConfigModule, JWT і нові компоненти сповіщень
  для вимог ТЗ щодо стрічки активності та real-time.
- `health.controller.ts` — Terminus із перевіркою БД: тепер readiness залежить
  від з'єднання. Успішна відповідь зберігає `status: "ok"`, додає стан БД і Redis;
  Redis down означає деградацію, REST-стрічка лишається доступною.
- `main.ts` — Swagger `/docs`, валідація query, CORS і Socket.IO-адаптер;
  shutdown hooks очікують завершення активної обробки до закриття БД.
- `package.json` — сумісні з NestJS 10/Node 20 залежності, скрипти міграцій та
  інтеграційних тестів; прибрано `--passWithNoTests`, бо тести вже є.
- `.env.example` — БД, Redis, спільний JWT-секрет, CORS і параметри консюмера.
  Compose доповнено очікуванням здорових `notifications-db` і `redis`;
  CI запускає unit та інтеграційні тести з реальними залежностями.

### Зміни стартового коду для спостережуваності

- У `main.ts` трьох Nest-сервісів першим імпортується tracing, увімкнено
  буферизацію стартових логів і підключено nestjs-pino замість `console.log`.
  Це потрібно для раннього patch-інструментування й структурованих логів.
- `app.module.ts` підключає новий модуль логів, метрик і завершення SDK;
  `package.json`/lockfiles та `.env.example` доповнено сумісними залежностями
  й налаштуваннями. Auth і його конфігурацію не переписано.
- `docker-compose.yml` доповнено Jaeger з OTLP HTTP і UI.
- Інтеграційний тест lease у payments отримав залежність метрик у конструкторі
  runner; перевірки конкурентного виконання залишились тими самими.

### Порядок state-push і конфігурація tracing

Обидва relay додають у конверт події необов'язкову `position` — десятковий рядок
`outbox.id`, незмінний під час повторної публікації. Redis ID залишається ID
доставки й не використовується для впорядкування стану. Позиції різних
продюсерів не порівнюються. Операції одного гаманця та переходи однієї саги
серіалізуються наявними блокуваннями рядків у сервісі-власнику.

Notifications зберігає останню позицію у `push_update_positions` за ключем
`producer/event/resource_id`: гаманець для `wallet.balance`, переказ для
`transfer.status`. Маркер, activity й дедуплікація комітяться однією транзакцією
через її EntityManager. Застарілий state push (повторна доставка після reclaim
або повторна публікація outbox) відкидається, activity зберігається. Усі
одержувачі актуального переказу отримують push, маркер спільний для переказу.

Продюсерів і notifications слід оновлювати разом: конверти без `position`
обробляються зі збереженням activity та ACK, але без state push; актуальний стан
клієнт читає через REST на кожен connect.

Тести перевіряють: reclaim не повертає новіший баланс до старого, проміжний
статус після COMPLETED не надсилається повторно, повторно опублікована стара
подія з новим Redis ID не відкочує баланс, старі конверти, валідацію `position`
(включно з точністю bigint), обох одержувачів переказу та незмінність `position`
при повторній публікації relay. Окремі процесні тести запускають `tracing.ts` без
`OTEL_*` у середовищі й перевіряють реальний OTLP-експорт з іменем сервісу та
адресою колектора, заданими лише в `.env`.

JWT перевіряється при WS-handshake. Сплив JWT сам собою не від'єднує вже
автентифіковану WS-сесію; політика строку активної сесії потребує окремого
рішення. Нове підключення завжди проходить перевірку токена.


## Frontend: серверні дані та live-оновлення

Сторінки `/wallets`, `/transfers/new`, `/split-bills`, `/split-bills/[id]`,
`/activity` і `/admin` доступні після входу. Гаманці можна відкрити у USD/EUR/UAH
і поповнити тестовими коштами. Переказ приймає email отримувача, суму у валюті
обраного гаманця й валюту зарахування. Split-рахунок підтримує поділ порівну
або власні суми (у кожному рядку: email, пробіл, сума), необов’язковий термін
оплати, окреме підтвердження та оплату власної частки.

- **Server/Client Components.** Початкові гаманці, рахунки й активність
  завантажуються Server Components через `lib/api.ts` без кешу. Client Components
  обробляють форми, Socket.IO, повторні спроби, фільтри й прогрес переказу.
  Створення рахунку та підтвердження частки викликають Server Actions; кожна
  action звертається до BFF з cookie поточного користувача. Сервіс-власник
  повторно перевіряє права. Грошові мутації виконуються через fetch із явним
  `Idempotency-Key`. Базова HTML/серверна валідація доповнює DTO BFF і сервісів.
- **Ідемпотентність форми.** Ключ UUID створюється один раз для спроби разом
  зі знімком тіла. Після мережевої помилки/5xx та тимчасових 401/403/408/429
  поля заблоковано, кнопка повтору надсилає той самий ключ і тіло. Ці відповіді
  не спростовують успішного виконання попередньої спроби, відповідь якої
  загубилась. Після остаточної 4xx-відмови форму можна
  виправити, а новий переказ після фінального статусу починає нову спробу.
  Це працює протягом життя відкритої форми; збереження незавершеної форми
  між перезавантаженнями сторінки не реалізовано. Такий самий ключ використовується
  для поповнення, оплати частки й створення split-рахунку через Server Action.
- **Live.** `useLiveSocket` підключається до namespace `/ws`, показує
  online/offline/reconnecting, отримує `wallet.balance`, `transfer.status`
  і `activity.created`. Кожен `connect`, включно з reconnect, запускає REST-refetch
  відповідного стану; новий handshake бере свіжий токен. Активний переказ
  додатково опитується до COMPLETED/FAILED: наступний polling-запит починається
  через 2 секунди після завершення попереднього, тому повільна відповідь
  не губиться через перекриття запитів. При виході зі сторінки таймер
  скасовується, запізнілі відповіді ігноруються. Частки PAYING опитуються
  до зміни стану. Стрічка повторно читається з поточним фільтром після push.
- **Адмінка.** Журнал гаманця, reconciliation за період та останні traces
  завантажуються незалежними Suspense-секціями. Відмова Jaeger не приховує
  решту секцій. Тривалість кожної спроби `saga.step *` береться з OTel через
  BFF `/admin/traces`, у мілісекундах. Роль у UI — лише підказка;
  BFF і ledger самі перевіряють JWT та admin. Є loading/empty/error стани.

### Доступ до BFF та сесія

Server Components і Server Actions викликають `BFF_URL` напряму. Клієнт ходить
через `/api/bff/[...path]`: route handler додає Bearer з httpOnly-cookie,
передає `Idempotency-Key`, статус, JSON помилки та `Retry-After`. Дозволені лише
публічні групи маршрутів BFF; POST перевіряє Origin/Host. Автоматичних повторів
мутацій немає. Мережева помилка/таймаут повертається як 503.

`middleware.ts` оновлює access token через BFF `/auth/refresh`, коли він
прострочений або до спливу лишилось менше 10 секунд. Нові cookie доступні вже
поточному серверному рендеру. Недійсний refresh → login/401 і очищення cookie;
тимчасова недоступність → 503 зі збереженням сесії для повтору. Паралельні
refresh одного токена об’єднуються в межах одного процесу; кілька frontend
інстансів потребуватимуть окремого узгодження ротації. Cookie мають HttpOnly,
SameSite=Lax та Secure при HTTPS.

`GET /api/auth/ws-token` повертає access token і runtime `WS_PUBLIC_URL` без
кешування. Це свідомий компроміс httpOnly для Socket.IO handshake: access token
стає доступним коду сторінки в пам’яті, refresh token залишається лише у cookie.
Токени не зберігаються в localStorage. При розгортанні за межами localhost
`WS_PUBLIC_URL` має вказувати на доступну браузеру адресу notifications,
а його `CORS_ORIGIN` — на адресу фронтенду.

### Зміни стартового коду frontend

- `lib/api.ts` тепер викликає BFF замість ledger; auth API-проксі login/register
  використовують його та зберігають upstream-статуси помилок. Наявні сторінки
  login/register залишені без змін.
- `/wallets` зберігає початкове завантаження на сервері й передає його новому
  Client Component для live-балансів, відкриття гаманця та поповнення.
- `layout.tsx` доповнено навігацією до реалізованих сторінок; inline styles
  і мінімальний стиль стартера збережено.
- `.env.example` та frontend-секція Compose використовують `BFF_URL` замість
  прямих `LEDGER_SERVICE_URL`/`PAYMENTS_SERVICE_URL`. `NEXT_PUBLIC_WS_URL` замінено
  на `WS_PUBLIC_URL`: адреса надходить у runtime з `/api/auth/ws-token`,
  тому її не потрібно вбудовувати під час `next build`. Frontend чекає healthy BFF.
- Додано `socket.io-client@^4` та HTTP-тести на вбудованому Node test runner,
  без додаткового тестового фреймворку. Наявні тести сервісів не змінювались.
  Frontend job CI після production build запускає `npm test`.

Перевірка фронтенду (Node 20):

```bash
cd apps/frontend
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm test
```

HTTP-тести запускають production Next.js та локальний HTTP-двійник BFF на
вільних портах. Перевіряють cookie/refresh і паралельний refresh, серверне
завантаження балансів, WS-token, прозоре передавання ключа/тіла/статусів/422/429,
Origin-захист, недоступність internal-маршрутів, фільтр активності та незалежні
секції адмінки при відмові traces. Для `npm test` потрібна готова `.next`
після `npm run build`. Локально без контейнера: `BFF_URL=http://localhost:3004 WS_PUBLIC_URL=http://localhost:3003 npm run dev`.

Клієнтські регресійні тести використовують реальний React DOM, `act` і
`jsdom@^26` (лише dev-залежність, сумісна з Node 20). Виконуються поточні
TS/TSX-компоненти та хук; підмінено мережу й Socket.IO, таймери керовані через
Node test runner. Перевіряються втрачена відповідь після створення переказу
з наступною тимчасовою відмовою і повтором без дублювання, можливість
виправлення форми після 400, повільний polling, повтор після помилки,
зупинка при unmount і захист від запізнілої відповіді іншого переказу.
Наявні HTTP-тести не змінено.

Підходи відповідають документації [Next.js 14: Middleware](https://nextjs.org/docs/14/app/building-your-application/routing/middleware),
[Server Actions](https://nextjs.org/docs/14/app/building-your-application/data-fetching/server-actions-and-mutations)
і [Socket.IO 4: Client options](https://socket.io/docs/v4/client-options/).
Послідовний polling спирається на
[MDN: recursive setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency),
очищення ефектів і захист від запізнілих відповідей — на
[React: useEffect](https://react.dev/reference/react/useEffect#fetching-data-with-effects),
клієнтські перевірки — на [React: act](https://react.dev/reference/react/act).
