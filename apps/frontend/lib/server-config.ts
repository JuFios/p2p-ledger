import { httpBudget } from './http-budget';

// Одна перевірка на завантаження серверного модуля, поза обробкою мережевих помилок.
export const FRONTEND_TIMEOUT_MS = httpBudget(
  Number(process.env.CB_TIMEOUT_MS ?? 3000),
).frontend;
