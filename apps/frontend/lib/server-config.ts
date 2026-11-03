import { httpBudget } from './http-budget';

// Одна перевірка на завантаження серверного модуля, поза обробкою мережевих помилок.
export const FRONTEND_TIMEOUT_MS = httpBudget(
  process.env.CB_TIMEOUT_MS,
  'frontend',
);

export const BFF_URL = process.env.BFF_URL ?? 'http://localhost:3004';
export const WS_PUBLIC_URL = process.env.WS_PUBLIC_URL ?? 'http://localhost:3003';
