# P2P Ledger — стартовий репозиторій

Це стартовий каркас для тестового завдання (`ТЗ_тестове_завдання_6`). Частина
сервісів уже працює, частина — лише каркас або TODO. Повний опис завдання —
у файлі ТЗ, який ви отримали окремо.

## Що вже працює

- `apps/ledger-service` — автентифікація (register/login/refresh) і базовий
  CRUD гаманців. Балансу гаманця бракує event sourcing — це частина завдання.
- `apps/frontend` — сторінки логіну, реєстрації та список гаманців (Next.js
  App Router, Server Component + API-роут-проксі для авторизації).

## Що ще НЕ реалізовано

- `apps/notifications-service` — порожній Nest-проєкт, лише `/health`.
- Форма переказу, split-рахунки, admin-екран на фронтенді.

## Запуск

```bash
docker-compose up --build
```

- ledger-service: http://localhost:3001
- payments-service: http://localhost:3002
- notifications-service: http://localhost:3003
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
тож кошти не лишаються в `held` без власника. Без `walletId` невідомий холд, як
і раніше, → `404`.
Звірку можна запустити й скриптом: `docker compose exec ledger-service npm run reconcile`
(код виходу 1 — є розбіжності).

Для локальної розробки без Docker: скопіюйте `.env.example` → `.env` у
кожному сервісі, підніміть Postgres окремо, `npm install && npm run start:dev`
у потрібному сервісі.

## Сага переказу (payments-service)

`POST /transfers` (JWT + обов'язковий заголовок `Idempotency-Key`, 1–128 символів) лише створює переказ у статусі `PENDING` і відповідає `202`; далі його веде фоновий saga runner. Статус — `GET /transfers/:id`: відправник бачить переказ завжди, отримувач — лише після зарахування (`COMPLETED`; невдалі й незавершені перекази його не стосуються), іншим — 404; список — `GET /transfers?limit=`. Swagger — http://localhost:3002/docs.

- **Оркестрація.** Координатор — payments-service, стан саги — рядок `transfers` (`status` + `step`). Кроки: `RISK_CHECK` (ліміт `TRANSFER_MAX_AMOUNT`, чорний список `BLOCKED_EMAILS`) → `RESOLVE_RECIPIENT` (користувач за email, переказ собі відхиляється за `userId`, і його гаманець у валюті зарахування, створюється за потреби) → `FX_QUOTE` (курс з кешу, сума зарахування округлюється вниз) → `HOLD` → `CONFIRM` (курс не старший `FX_MAX_QUOTE_AGE_MS`, отримувач не заморожений) → `CAPTURE` (списання з холду й зарахування отримувачу — одна транзакція в ledger).
- **Компенсація.** Відмова до холду → `FAILED`, відкочувати нічого. Відмова на `CONFIRM`/`CAPTURE` → `COMPENSATING` → `RELEASE_HOLD` (кошти повертаються в available, ledger пише `TransferFailed`) → `FAILED`. Компенсація повторюється, доки ledger її не прийме. Release передає гаманець відправника (`walletId`): якщо запит на холд застряг і ledger його ще не бачив, release під блокуванням гаманця лишає слід (запис в `operations`), і запізнілий холд отримує `409 HOLD_NOT_ACTIVE` замість того, щоб назавжди зависнути в `held`.
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

## Тести

```bash
cd apps/ledger-service && npm test
cd apps/payments-service && npm test
```

Інтеграційні тести payments (`apps/payments-service/test/e2e`) ходять у реальний Postgres на окремій БД `payments_e2e`; ledger у них підміняє HTTP-двійник internal API (`fake-ledger.ts`) — у кожного сервісу своя БД, тож справжній ledger тут не піднімається:

```bash
docker compose up -d payments-db redis
docker compose exec payments-db createdb -U payments payments_e2e
cd apps/payments-service && npm run test:e2e
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
| CI червоний | CI | `cache: npm` без lockfile, `jest` у payments без тестів → exit 1 | перший запуск CI | lockfiles у всіх сервісах; `jest --passWithNoTests` у payments прибрано, щойно з'явились тести (у notifications — тимчасово лишається) |
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
