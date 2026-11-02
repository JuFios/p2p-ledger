import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { NotificationsGateway } from '../../src/events/notifications.gateway';
import { configureApp } from '../../src/configure-app';

describe('WebSocket access token expiry', () => {
  let app: INestApplication;
  let url: string;
  const secret = process.env.JWT_ACCESS_SECRET ?? 'socket-expiry-test-secret';
  const jwt = new JwtService({ secret });
  const sockets: Socket[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        JwtService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_ACCESS_SECRET: secret,
            CORS_ORIGIN: 'http://localhost:3000',
          }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0);
    url = await app.getUrl();
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  });
  async function connect(expiresIn: number) {
    const socket = io(`${url}/ws`, {
      auth: { token: jwt.sign({ sub: randomUUID() }, { expiresIn }) },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }
  it('disconnects an expired socket without affecting another user', async () => {
    const long = await connect(60);
    const short = await connect(2);
    const reason = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('socket remained connected after expiry')),
        3500,
      );
      short.once('disconnect', (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
    expect(reason).toBe('io server disconnect');
    expect(short.connected).toBe(false);
    expect(long.connected).toBe(true);
  });
});
