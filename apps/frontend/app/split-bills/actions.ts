'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, bffFetch } from '@/lib/api';
import { CURRENCIES, parseBill, SplitBill } from '@/lib/types';
import { money, uuid } from '@/lib/validation';

export async function createBill(
  data: FormData,
): Promise<{ id?: string; error?: string; status?: number }> {
  try {
    const title = String(data.get('title') ?? '').trim();
    const currency = String(data.get('currency'));
    const mode = String(data.get('mode'));
    const key = String(data.get('key'));
    if (
      !title ||
      title.length > 100 ||
      !CURRENCIES.some((c) => c === currency) ||
      !['EQUAL', 'CUSTOM'].includes(mode) ||
      !uuid(key)
    )
      throw new Error('Перевірте назву, валюту та спосіб поділу.');
    const participants = String(data.get('participants') ?? '')
      .trim()
      .split(/\n/)
      .map((line) => {
        const [email, amount, extra] = line.trim().split(/\s+/);
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          extra ||
          (mode === 'EQUAL' && amount)
        )
          throw new Error('Перевірте email та суми учасників.');
        return mode === 'CUSTOM'
          ? { email, amount: money(amount ?? null) }
          : { email };
      });
    if (!participants.length || participants.length > 20)
      throw new Error('Додайте від 1 до 20 учасників.');
    const due = String(data.get('dueAt') ?? '');
    const dueAt = due ? new Date(due).toISOString() : undefined;
    const bill = await bffFetch<SplitBill>('/split-bills', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({
        title,
        totalAmount: money(data.get('totalAmount')),
        currency,
        mode,
        participants,
        dueAt,
      }),
    }, parseBill);
    revalidatePath('/split-bills');
    return { id: bill.id };
  } catch (err) {
    return {
      error: (err as Error).message,
      status: err instanceof ApiError ? err.status : 400,
    };
  }
}

export async function acceptShare(
  billId: string,
  shareId: string,
): Promise<{ error?: string }> {
  if (!uuid(billId) || !uuid(shareId))
    return { error: 'Некоректний ідентифікатор.' };
  try {
    await bffFetch(`/split-bills/${billId}/shares/${shareId}/accept`, {
      method: 'POST',
    });
    revalidatePath(`/split-bills/${billId}`);
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}
