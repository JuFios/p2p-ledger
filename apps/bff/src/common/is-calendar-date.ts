import { isISO8601, registerDecorator } from 'class-validator';

// Лише календарна дата або дата-час із явним часовим поясом; Date не читає
// тижневі/порядкові/basic ISO, а некоректні дні може мовчки нормалізувати.
export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) &&
    !value.startsWith('0000-') &&
    isISO8601(value, { strict: true, strictSeparator: true }) &&
    Number.isFinite(Date.parse(value));
}
export function IsCalendarDate() {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isCalendarDate', target: target.constructor, propertyName,
    options: { message: `${propertyName} must be YYYY-MM-DD or an ISO date-time with timezone` },
    validator: { validate: isCalendarDate },
  });
}
