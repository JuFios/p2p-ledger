import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { NotificationsGateway } from '../src/events/notifications.gateway';

describe('Socket expiry timers', () => {
  let gateway: NotificationsGateway;
  const makeSocket = (connected = true) => ({
    connected,
    data: { userId: 'user', exp: Date.now() / 1000 + 2 },
    join: jest.fn(async () => {}),
    disconnect: jest.fn(),
  });
  beforeEach(() => {
    jest.useFakeTimers();
    gateway = new NotificationsGateway(new JwtService(), new ConfigService());
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it('disconnects at expiry and does not affect another socket', async () => {
    const socket = makeSocket(),
      other = makeSocket();
    other.data.exp += 10;
    await gateway.handleConnection(socket as unknown as Socket);
    await gateway.handleConnection(other as unknown as Socket);
    jest.advanceTimersByTime(1999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
    gateway.handleDisconnect(other as unknown as Socket);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('clears the timer when the client disconnects', async () => {
    const socket = makeSocket();
    await gateway.handleConnection(socket as unknown as Socket);
    gateway.handleDisconnect(socket as unknown as Socket);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(3000);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
  it('does not install a late timer for an already disconnected socket', async () => {
    const socket = makeSocket(false);
    await gateway.handleConnection(socket as unknown as Socket);
    expect(jest.getTimerCount()).toBe(0);
  });
});
