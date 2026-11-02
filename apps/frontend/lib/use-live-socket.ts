'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Activity, TransferUpdate, WalletUpdate } from './types';

interface LiveHandlers {
  onConnect?: () => void;
  onWallet?: (value: WalletUpdate) => void;
  onTransfer?: (value: TransferUpdate) => void;
  onActivity?: (value: Activity) => void;
}

export function useLiveSocket(handlers: LiveHandlers) {
  const callbacks = useRef(handlers);
  callbacks.current = handlers;
  const [status, setStatus] = useState<'online' | 'offline' | 'reconnecting'>(
    'reconnecting',
  );
  useEffect(() => {
    let stopped = false;
    let socket: Socket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const schedule = (fn: () => void) => {
      clearTimeout(retry);
      if (!stopped) retry = setTimeout(fn, 3000);
    };
    async function start() {
      try {
        const res = await fetch('/api/auth/ws-token', { cache: 'no-store' });
        if (!res.ok) throw new Error('session unavailable');
        const { url } = await res.json();
        if (stopped) return;
        socket = io(`${url.replace(/\/$/, '')}/ws`, {
          autoConnect: false,
          auth: (done) => {
            // Кожен handshake бере свіжий access token, включно з refresh.
            fetch('/api/auth/ws-token', { cache: 'no-store' })
              .then(async (response) => {
                if (!response.ok) throw new Error('session unavailable');
                return response.json();
              })
              .then(({ token }) => {
                if (!stopped) done({ token });
              })
              .catch(() => {
                if (!stopped) done({ token: '' });
              });
          },
        });
        socket.on('connect', () => {
          setStatus('online');
          callbacks.current.onConnect?.();
        });
        socket.on('disconnect', (reason) => {
          setStatus(navigator.onLine ? 'reconnecting' : 'offline');
          if (reason === 'io server disconnect' && navigator.onLine)
            schedule(() => socket?.connect());
        });
        socket.on('connect_error', () => {
          setStatus(navigator.onLine ? 'reconnecting' : 'offline');
          if (!socket?.active) schedule(() => socket?.connect());
        });
        socket.on('wallet.balance', (value: WalletUpdate) =>
          callbacks.current.onWallet?.(value),
        );
        socket.on('transfer.status', (value: TransferUpdate) =>
          callbacks.current.onTransfer?.(value),
        );
        socket.on('activity.created', (value: Activity) =>
          callbacks.current.onActivity?.(value),
        );
        socket.connect();
      } catch {
        if (!stopped) {
          setStatus(navigator.onLine ? 'reconnecting' : 'offline');
          schedule(start);
        }
      }
    }
    const offline = () => {
      socket?.disconnect();
      setStatus('offline');
    };
    const online = () => {
      setStatus('reconnecting');
      socket?.connect();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    void start();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.removeAllListeners();
      socket?.disconnect();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);
  return status;
}
