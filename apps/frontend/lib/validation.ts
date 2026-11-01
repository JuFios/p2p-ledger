export function money(value: FormDataEntryValue | null): number {
  const text = String(value ?? '').trim();
  if (
    !/^\d+(\.\d{1,2})?$/.test(text) ||
    Number(text) <= 0 ||
    Number(text) > 1000000
  ) {
    throw new Error(
      'Сума має бути від 0.01 до 1000000 і містити не більше двох знаків після крапки.',
    );
  }
  return Number(text);
}
export function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
