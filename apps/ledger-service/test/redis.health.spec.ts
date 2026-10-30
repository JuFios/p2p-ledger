import Redis from 'ioredis';
import { RedisHealthIndicator } from '../src/health/redis.health';

// Запис у ledger від Redis не залежить (події чекають в outbox), тож недоступний
// Redis — це деградація, а не відмова сервісу.
describe('RedisHealthIndicator', () => {
  const indicator = (ping: jest.Mock) =>
    new RedisHealthIndicator({ ping } as unknown as Redis);

  it('up, коли Redis відповідає', async () => {
    await expect(
      indicator(jest.fn().mockResolvedValue('PONG')).pingCheck('redis'),
    ).resolves.toEqual({ redis: { status: 'up' } });
  });

  it('недоступний Redis позначає як down, не валячи health', async () => {
    await expect(
      indicator(jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))).pingCheck(
        'redis',
      ),
    ).resolves.toMatchObject({ redis: { status: 'down' } });
  });
});
