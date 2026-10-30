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

> Чорновик (Етап 1). Остаточний текст — в Етапі 10.

Закладені проблеми (B1–B4) і знайдені під час роботи (дублікати гаманців, 500 на малих сумах, F4) відтворює тест, який **червоний до виправлення** і зелений після. У git це пари комітів (перший — тест, другий — виправлення), а не «один коміт на все»:

| Проблема | Червоний тест → виправлення |
|---|---|
| B1 | `80a66d4` → `4ba7c94` (`9583e13` — перша версія тесту, частково червона через `ECONNRESET` самого хелпера) |
| B2, B3 | `f374002` → `00728ee` |
| B3: суми на кшталт `1e-7` давали 500 (`maxDecimalPlaces` кидає `TypeError`) | `24417a7` → `7ba0722` |
| `POST /wallets` — гонка, дублікати гаманця | `d8679ba` → `a049d00` |
| B4 | `f49cdbf` (тест і є виправленням; доказ мутацією нижче) |
| F4 | `e23e314` → `6e1b6c2` (на той момент тест піднімав `AppModule`; потім переписаний на пряму перевірку `validate()` у `a64659a`, бо бут модуля залежить від локального `.env`) |

**F1, F2, F6–F8 автотестів не мають** — їх перевірено вручну (запущений стек / `docker compose up --build` / CI); F3 і F5 закриваються пізніше. E2E-тести ходять у реальний Postgres через HTTP (`apps/ledger-service/test/e2e`), тому переживуть подальший рефакторинг ledger без змін.

| ID | Категорія ТЗ | Суть | Як знайдено / чим відтворено | Виправлення |
|---|---|---|---|---|
| **B1** | конкурентний доступ | `withdraw`/`deposit` читають баланс, рахують у JS (`Number`) і зберігають без транзакції та блокування → double spend і lost update | `wallets-concurrency.e2e-spec.ts`: 20 паралельних `withdraw(10)` зі 100 — на старті всі 20 дають 201; 20 паралельних `deposit(10)` лишають 20–40 замість 200 | транзакція + `pessimistic_write` на рядок гаманця, арифметика в SQL над `numeric` |
| **B2** | авторизація (IDOR) | `GET/deposit/withdraw` по `:id` не звіряють власника → будь-який користувач бачить, поповнює й списує чужий гаманець | `wallets-access.e2e-spec.ts`: користувач B на гаманець A — на старті 200/201 | сервіс приймає `userId` і шукає `{ id, ownerId }`; чужий гаманець → 404 (не розкриваємо існування) |
| **B3** | валідація | `:id` не перевіряється як UUID (500 від Postgres); `amount` без перевірки знаків після коми (0.001 → гроші «зникають» через `toFixed(2)`) і без верхньої межі (переповнення `numeric(18,2)` → 500) | `wallets-access.e2e-spec.ts` | `ParseUUIDPipe`; власний декоратор `@IsMoneyAmount` (додатне, ≤ 1 000 000, ≤ 2 знаки). Штатний `@IsNumber({ maxDecimalPlaces })` не підійшов: на `1e-7` він сам кидає `TypeError` → 500 |
| **B4** | тест, що проходить «випадково» | у тесті овердрафту проміс не `await`-ається й немає `expect.assertions` → зелений навіть без перевірки в сервісі | мутація на коміті `f49cdbf`: прибрати `if (current < amount)` у `withdraw` — старий тест лишається зеленим, новий — червоний («Received promise resolved instead of rejected») | `await expect(...).rejects.toBeInstanceOf(BadRequestException)`, `expect.assertions`, перевірка, що запису не було (після переходу на транзакцію аналог мутації — прибрати `if (!sufficient)`) |
| **—** | race condition | `POST /wallets`: `findOne` → `save` без UNIQUE → паралельні виклики створюють дублікати гаманця однієї валюти, далі `findOne` повертає довільний | `wallets-concurrency.e2e-spec.ts`: 10 паралельних запитів → 10 гаманців | `UNIQUE(ownerId, currency)` + `INSERT … ON CONFLICT DO NOTHING` |
| **F1** | фронтенд | `lib/api.ts` не передає `Authorization`, кука `accessToken` ніде не читається → `/wallets` завжди «Ledger API 401» | запущений стек: `GET /wallets` після логіну | `ledgerFetch` читає токен з `cookies()`. Токен живе `JWT_ACCESS_TTL` (15 хв); після спливу сторінка знову покаже 401, бо оновлення токена (refresh) буде в Етапі 8 |
| **F2** | CI | CI червоний: `cache: npm` без lockfile, `jest` у payments без тестів → exit 1 | перший запуск CI | lockfiles у всіх сервісах, `jest --passWithNoTests` (тимчасово; так само в notifications) |
| **F3** | авторизація | `payments-service` `TransfersController` без JWT-guard, `GET /transfers/:id` без перевірки власника | огляд коду | Етап 3 |
| **F4** | конфігурація | JWT-секрети мають захардкоджені fallback'и (`'change-me-access'`) — сервіс стартує з відомим секретом, якщо змінну не задано | `env.spec.ts` | `ConfigModule.forRoot({ validate })`: без `DATABASE_*`/`JWT_*_SECRET` сервіс не стартує (auth-модуль не чіпали). **Обмеження:** `docker compose` бере секрети з публічного `.env.example` (`change-me-*`) — це демо-значення, а не захищений секрет; поза локальним запуском їх обов'язково замінити |
| **F5** | архітектура | ORM-зв'язок `User` ↔ `Wallet` змішує auth-контекст з ledger | огляд коду | Етап 2 |
| **F6** | старт сервісу | `User.refreshTokenHash: string \| null` без явного типу колонки → `DataTypeNotSupportedError`, ledger не стартує проти Postgres (unit-тести мокають репозиторій і цього не бачать) | `docker compose up --build` | `@Column({ type: 'varchar', nullable: true })` |
| **F7** | збірка | у `tsconfig.json` немає `include`, а в ledger є `test/` → вихід у `dist/src/main.js`, а образ запускає `node dist/main` | `docker compose up --build` | `tsconfig.build.json` без `test` |
| **F8** | Docker | немає `.dockerignore`: `COPY . .` затирає `node_modules` образу хостовими — натівний `bcrypt` з macOS у Linux-образі дає `Exec format error` | зібрати образ без `.dockerignore` після локального `npm install` | `.dockerignore` (`node_modules`, `dist`, `.env`) у сервісах |

### Змінені стартові тести

`apps/ledger-service/test/wallets.service.spec.ts`:
- B4 — тест овердрафту переписано (див. вище).
- Сервіс тепер приймає `userId` і працює через транзакцію (`DataSource.transaction`), тому репозиторій у тесті замінено на мок `EntityManager`. Unit-тести перевіряють лише оркестрацію: чужий гаманець шукається за парою `{ id, ownerId }` і дає `NotFoundException` до будь-якого SQL; недостатньо коштів → `BadRequestException` без `UPDATE`; депозит викликає `UPDATE` з потрібними параметрами. **Арифметику балансу мок не перевіряє** — її покривають e2e (`wallets.e2e-spec.ts`: баланс після депозиту/зняття, зняття рівно всього балансу проходить, на копійку більше — ні, депозит не чіпає чужі гаманці). Це перевірено мутаціями (`>=` → `<=`, `WHERE id <> $2`, зняття фільтра власника, зміна ліміту суми) — кожна валить хоча б один тест.

`npm test` у ledger не запускає `test/e2e`; e2e — окремо: `docker compose up -d ledger-db && npm run test:e2e`.
