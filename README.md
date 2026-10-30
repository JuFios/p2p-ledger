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

Кожну проблему відтворює тест, який **червоний на стартовому коді** і зелений після виправлення; у git це видно як пару комітів `test: reproduce …` → `fix: …`. E2E-тести ходять у реальний Postgres через HTTP (`apps/ledger-service/test/e2e`), тому переживуть подальший рефакторинг ledger без змін.

| ID | Категорія ТЗ | Суть | Як знайдено / чим відтворено | Виправлення |
|---|---|---|---|---|
| **B1** | конкурентний доступ | `withdraw`/`deposit` читають баланс, рахують у JS (`Number`) і зберігають без транзакції та блокування → double spend і lost update | `wallets-concurrency.e2e-spec.ts`: 20 паралельних `withdraw(10)` зі 100 — на старті всі 20 дають 201; 20 паралельних `deposit(10)` лишають 20–40 замість 200 | транзакція + `pessimistic_write` на рядок гаманця, арифметика в SQL над `numeric` |
| **B2** | авторизація (IDOR) | `GET/deposit/withdraw` по `:id` не звіряють власника → будь-який користувач бачить, поповнює й списує чужий гаманець | `wallets-access.e2e-spec.ts`: користувач B на гаманець A — на старті 200/201 | сервіс приймає `userId` і шукає `{ id, ownerId }`; чужий гаманець → 404 (не розкриваємо існування) |
| **B3** | валідація | `:id` не перевіряється як UUID (500 від Postgres); `amount` без `maxDecimalPlaces` (0.001 → гроші «зникають» через `toFixed(2)`) і без верхньої межі (переповнення `numeric(18,2)` → 500) | `wallets-access.e2e-spec.ts` | `ParseUUIDPipe`; `@IsNumber({ maxDecimalPlaces: 2 })`, `@Max(1_000_000)` |
| **B4** | тест, що проходить «випадково» | у тесті овердрафту проміс не `await`-ається й немає `expect.assertions` → зелений навіть без перевірки в сервісі | мутація: прибрати `if (current < amount)` у `withdraw` — старий тест лишається зеленим, новий — червоний | `await expect(...).rejects.toBeInstanceOf(BadRequestException)`, `expect.assertions`, перевірка, що запису не було |
| **F1** | фронтенд | `lib/api.ts` не передає `Authorization`, кука `accessToken` ніде не читається → `/wallets` завжди «Ledger API 401» | запущений стек: `GET /wallets` після логіну | `ledgerFetch` читає токен з `cookies()` |
| **F2** | CI | CI червоний: `cache: npm` без lockfile, `jest` у payments без тестів → exit 1 | перший запуск CI | lockfiles у всіх сервісах, `jest --passWithNoTests` (тимчасово) |
| **F3** | авторизація | `payments-service` `TransfersController` без JWT-guard, `GET /transfers/:id` без перевірки власника | огляд коду | Етап 3 |
| **F4** | конфігурація | JWT-секрети мають захардкоджені fallback'и (`'change-me-access'`) — сервіс стартує з відомим секретом | `env.spec.ts` | `ConfigModule.forRoot({ validate })`: без `DATABASE_*`/`JWT_*_SECRET` сервіс не стартує (auth-модуль не чіпали) |
| **F5** | архітектура | ORM-зв'язок `User` ↔ `Wallet` змішує auth-контекст з ledger | огляд коду | Етап 2 |
| **F6** | старт сервісу | `User.refreshTokenHash: string \| null` без явного типу колонки → `DataTypeNotSupportedError`, ledger не стартує проти Postgres (unit-тести мокають репозиторій і цього не бачать) | `docker compose up --build` | `@Column({ type: 'varchar', nullable: true })` |
| **F7** | збірка | у `tsconfig.json` немає `include`, а в ledger є `test/` → вихід у `dist/src/main.js`, а образ запускає `node dist/main` | `docker compose up --build` | `tsconfig.build.json` без `test` |
| **F8** | Docker | немає `.dockerignore`: `COPY . .` затирає `node_modules` образу хостовими й тягне `dist/tsconfig.tsbuildinfo` → `nest build` нічого не емітить | `docker compose up --build` після локального `tsc --noEmit` | `.dockerignore` у сервісах |

### Змінені стартові тести

`apps/ledger-service/test/wallets.service.spec.ts`:
- B4 — тест овердрафту переписано (див. вище).
- B1/B2 — сервіс тепер приймає `userId` і працює через транзакцію (`DataSource.transaction`), тому репозиторій у тесті замінено на мок `EntityManager`. Перевірки поведінки ті самі: депозит збільшує баланс, зняття понад баланс → `BadRequestException` і без запису; додано перевірку, що чужий гаманець → `NotFoundException`.

`npm test` у ledger не запускає `test/e2e`; e2e — окремо: `docker compose up -d ledger-db && npm run test:e2e`.
