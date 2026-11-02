import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { Namespace, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/ws' })
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Namespace;
  private readonly expiryTimers = new WeakMap<
    Socket,
    ReturnType<typeof setTimeout>
  >();
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Namespace) {
    server.use(async (socket, next) => {
      try {
        const token: unknown = socket.handshake.auth.token;
        if (typeof token !== 'string') throw new Error('Missing token');
        const payload = await this.jwt.verifyAsync<{
          sub: string;
          exp?: number;
        }>(token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          algorithms: ['HS256'],
        });
        if (!isUUID(payload.sub)) throw new Error('Invalid subject');
        socket.data.userId = payload.sub;
        socket.data.exp = payload.exp;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(socket: Socket) {
    await socket.join(`user:${socket.data.userId}`);
    if (
      !socket.connected ||
      typeof socket.data.exp !== 'number' ||
      !Number.isFinite(socket.data.exp)
    )
      return;
    const timer = setTimeout(
      () => {
        this.expiryTimers.delete(socket);
        socket.disconnect(true);
      },
      Math.max(0, socket.data.exp * 1000 - Date.now()),
    );
    timer.unref();
    this.expiryTimers.set(socket, timer);
  }

  handleDisconnect(socket: Socket) {
    const timer = this.expiryTimers.get(socket);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(socket);
  }

  emit(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
