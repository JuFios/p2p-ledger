import { api, eventually } from './helpers';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('reports an unexpected HTTP status even when the body is HTML', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response('<html>unavailable</html>', { status: 503 }),
    );
  await expect(api('/wallets')).rejects.toThrow(
    '/wallets: HTTP 503, expected 200',
  );
});

it('accepts an explicitly expected empty response', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 204 }));
  await expect(
    api('/wallets', undefined, undefined, undefined, [204]),
  ).resolves.toEqual({ status: 204, body: undefined });
});

it('retries a transient read failure and returns the next valid value', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response('upstream unavailable', { status: 503 }),
    )
    .mockResolvedValueOnce(new Response('{"ready":true}', { status: 200 }));
  const result = await eventually(
    () => api<{ ready: boolean }>('/wallets'),
    (r) => r.body.ready,
    'read',
  );
  expect(result.body.ready).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('retries a timed out read', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    .mockResolvedValueOnce(new Response('{}'));
  await eventually(
    () => api('/wallets'),
    () => true,
    'read',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([401, 404, 422, 429])(
  'fails immediately on HTTP %i while polling',
  async (status) => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status }));
    await expect(
      eventually(
        () => api('/wallets'),
        () => true,
        'read',
      ),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('does not repeat a mutation after an upstream failure', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { status: 503 }));
  await expect(
    eventually(
      () => api('/transfers', 'token', {}, 'key', [202]),
      () => true,
      'write',
    ),
  ).rejects.toThrow('HTTP 503');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not repeat a mutation after a timeout', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
  await expect(
    eventually(
      () => api('/transfers', 'token', {}, 'key', [202]),
      () => true,
      'write',
    ),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not retry malformed successful JSON or assertion failures', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('invalid JSON'));
  await expect(
    eventually(
      () => api('/wallets'),
      () => true,
      'read',
    ),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  const read = jest.fn(async () => 1);
  await expect(
    eventually(
      read,
      () => {
        throw new Error('broken invariant');
      },
      'read',
    ),
  ).rejects.toThrow('broken invariant');
  expect(read).toHaveBeenCalledTimes(1);
});

it('stops retrying at the deadline and preserves the last HTTP diagnostic', async () => {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    now += 150;
    return new Response('unavailable', { status: 503 });
  });
  const failed = expect(
    eventually(
      () => api('/wallets'),
      () => true,
      'poll',
      300,
    ),
  ).rejects.toThrow(/poll: timeout.*HTTP 503/);
  await failed;
  expect(fetch).toHaveBeenCalledTimes(2);
});
