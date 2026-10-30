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

- `apps/payments-service` — лише каркас контролера/DTO, бізнес-логіки саги
  переказу немає (`NotImplementedException`).
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
Звірку можна запустити й скриптом: `docker compose exec ledger-service npm run reconcile`
(код виходу 1 — є розбіжності).

Для локальної розробки без Docker: скопіюйте `.env.example` → `.env` у
кожному сервісі, підніміть Postgres окремо, `npm install && npm run start:dev`
у потрібному сервісі.

## Тести

```bash
cd apps/ledger-service && npm test
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
| CI червоний | CI | `cache: npm` без lockfile, `jest` у payments без тестів → exit 1 | перший запуск CI | lockfiles у всіх сервісах, `jest --passWithNoTests` (тимчасово; так само в notifications) |
| `payments-service` без авторизації | авторизація | `TransfersController` без JWT-guard, `GET /transfers/:id` без перевірки власника | огляд коду | **ще не виправлено** — буде закрито разом з реалізацією `payments-service` (сага переказу) |
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
