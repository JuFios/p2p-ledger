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
| Ledger змішаний з auth через ORM-зв'язок | архітектура | зв'язок `User` ↔ `Wallet` змішує auth-контекст з ledger | огляд коду | **ще не виправлено** — буде закрито при рефакторингу ledger на event sourcing |
| Ledger не стартує проти Postgres | старт сервісу | `User.refreshTokenHash: string \| null` без явного типу колонки → `DataTypeNotSupportedError` (unit-тести мокають репозиторій і цього не бачать) | `docker compose up --build` | `@Column({ type: 'varchar', nullable: true })` |
| Образ ledger не запускається | збірка | у `tsconfig.json` немає `include`, а в ledger є `test/` → вихід у `dist/src/main.js`, а образ запускає `node dist/main` | `docker compose up --build` | `tsconfig.build.json` без `test` |
| Хостові `node_modules` потрапляють в образ | Docker | немає `.dockerignore`: `COPY . .` затирає `node_modules` образу хостовими — натівний `bcrypt` з macOS у Linux-образі дає `Exec format error` | зібрати образ без `.dockerignore` після локального `npm install` | `.dockerignore` (`node_modules`, `dist`, `.env`) у сервісах |

### Змінені стартові тести

`apps/ledger-service/test/wallets.service.spec.ts`:
- Тест овердрафту переписано (див. вище).
- Сервіс тепер приймає `userId` і працює через транзакцію (`DataSource.transaction`), тому репозиторій у тесті замінено на мок `EntityManager`. Unit-тести перевіряють лише оркестрацію: чужий гаманець шукається за парою `{ id, ownerId }` і дає `NotFoundException` до будь-якого SQL; недостатньо коштів → `BadRequestException` без `UPDATE`; депозит викликає `UPDATE` з потрібними параметрами. **Арифметику балансу мок не перевіряє** — її покривають e2e (`wallets.e2e-spec.ts`: баланс після депозиту/зняття, зняття рівно всього балансу проходить, на копійку більше — ні, депозит не чіпає чужі гаманці). Це перевірено мутаціями (`>=` → `<=`, `WHERE id <> $2`, зняття фільтра власника, зміна ліміту суми) — кожна валить хоча б один тест.

`npm test` у ledger не запускає `test/e2e`; e2e — окремо: `docker compose up -d ledger-db && npm run test:e2e`.
