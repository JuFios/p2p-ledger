import Redis from 'ioredis';
import { RedisHealthIndicator } from '../src/health/redis.health';

// Запис у ledger від Redis не залежить (події чекають в outbox), тож недоступний
// Redis — це деградація, а не відмова сервісу. Стан з'єднання читаємо без
// мережевого запиту: ping до Redis, що не відповідає, чекав би таймауту
// команди довше за таймаут healthcheck.
describe('RedisHealthIndicator', () => {
  const indicator = (status: string) => {
    const ping = jest.fn(() => new Promise(() => undefined));
    return {
      ping,
      check: new RedisHealthIndicator({ status, ping } as unknown as Redis),
    };
  };

  it('up, коли з\'єднання готове', async () => {
    const { check, ping } = indicator('ready');
    await expect(check.pingCheck('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
    expect(ping).not.toHaveBeenCalled();
  });

  it.each(['connecting', 'reconnecting', 'end'])(
    'з\'єднання %s → down одразу, не валячи health',
    async (status) => {
      const { check, ping } = indicator(status);
      await expect(check.pingCheck('redis')).resolves.toMatchObject({
        redis: { status: 'down' },
      });
      expect(ping).not.toHaveBeenCalled();
    },
  );
});
