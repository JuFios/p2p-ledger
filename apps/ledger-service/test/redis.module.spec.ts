import Redis from 'ioredis';
import { RedisModule } from '../src/redis/redis.module';

// Зупинка сервісу (SIGTERM) не повинна падати чи чекати, коли Redis недоступний.
describe('RedisModule shutdown', () => {
  const client = (status: string, quit: jest.Mock) => ({
    status,
    quit,
    disconnect: jest.fn(),
  });

  it('готове з\'єднання закриває коректно (QUIT)', async () => {
    const redis = client('ready', jest.fn().mockResolvedValue('OK'));
    await new RedisModule(redis as unknown as Redis).onApplicationShutdown();
    expect(redis.quit).toHaveBeenCalled();
    expect(redis.disconnect).not.toHaveBeenCalled();
  });

  it('без з\'єднання розриває одразу, не чекаючи QUIT', async () => {
    const redis = client('reconnecting', jest.fn(() => new Promise(() => undefined)));
    await new RedisModule(redis as unknown as Redis).onApplicationShutdown();
    expect(redis.quit).not.toHaveBeenCalled();
    expect(redis.disconnect).toHaveBeenCalled();
  });

  it('QUIT, що впав, не валить зупинку', async () => {
    const redis = client(
      'ready',
      jest.fn().mockRejectedValue(new Error('Command timed out')),
    );
    await expect(
      new RedisModule(redis as unknown as Redis).onApplicationShutdown(),
    ).resolves.toBeUndefined();
    expect(redis.disconnect).toHaveBeenCalled();
  });
});
