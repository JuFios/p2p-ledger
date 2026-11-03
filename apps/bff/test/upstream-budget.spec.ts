import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { UpstreamService } from '../src/proxy/upstream.service';

it('waits for a valid slow ledger-dependent operation and keeps a keyed replay unique', async () => {
  const saved = new Map<string, string>();
  const server = createServer(async (req, res) => {
    const key = String(req.headers['idempotency-key']);
    if (!saved.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 2700));
      saved.set(key, 'bill');
    }
    res.end(JSON.stringify({ id: saved.get(key) }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const service = new UpstreamService(new HttpService(), new ConfigService({ PAYMENTS_SERVICE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  try {
    const req = { headers: { 'idempotency-key': 'same-key' } };
    const first = await service.request('payments', '/split-bills', { method: 'POST', req });
    const repeat = await service.request('payments', '/split-bills', { method: 'POST', req });
    expect(first.data).toEqual(repeat.data);
    expect(saved.size).toBe(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}, 10000);

it('keeps timeout and connection diagnostics distinct without leaking request secrets', async () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const http = { axiosRef: { request: jest.fn() } };
  const service = new UpstreamService(http as unknown as HttpService, new ConfigService({ LEDGER_SERVICE_URL: 'http://ledger:3001' }));
  try {
    for (const code of ['ECONNABORTED', 'ECONNREFUSED']) {
      http.axiosRef.request.mockRejectedValueOnce(Object.assign(new Error('secret-body'), { code, config: { headers: { authorization: 'secret-token' } } }));
      await expect(service.request('ledger', '/wallets', { method: 'POST', body: 'secret-body', req: { headers: { authorization: 'secret-token' } } })).rejects.toMatchObject({ message: 'Upstream service unavailable' });
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatchObject({ category: 'timeout', source: 'ledger', method: 'POST', path: '/wallets' });
    expect(warn.mock.calls[1][0]).toMatchObject({ category: 'connection_refused' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-');
  } finally { warn.mockRestore(); }
});

it.each(['', ' ', 'invalid', '0', '60001'])('rejects invalid timeout configuration before serving requests (%s)', (value) => {
  expect(() => new UpstreamService(new HttpService(), new ConfigService({ CB_TIMEOUT_MS: value }))).toThrow('CB_TIMEOUT_MS');
});

it('computes the upstream budget once at startup', async () => {
  const config = new ConfigService({ CB_TIMEOUT_MS: '4000', LEDGER_SERVICE_URL: 'http://ledger:3001' });
  const request = jest.fn().mockResolvedValue({ status: 200 });
  const service = new UpstreamService({ axiosRef: { request } } as unknown as HttpService, config);
  config.set('CB_TIMEOUT_MS', '');
  await service.request('ledger', '/wallets');
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeout: 6000 }));
});
