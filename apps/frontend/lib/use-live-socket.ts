'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_RETRY_MS } from './timing';
import {
  Activity,
  TransferUpdate,
  WalletUpdate,
  validTransferUpdate,
  validWalletUpdate,
} from './types';

interface LiveHandlers {
  onConnect?: () => void;
  onWallet?: (value: WalletUpdate) => void;
  onTransfer?: (value: TransferUpdate) => void;
  onActivity?: (value: Activity) => void;
}

async function socketCredentials() {
  const response = await fetch('/api/auth/ws-token', { cache: 'no-store' });
  if (!response.ok) throw new Error('session unavailable');
  return response.json();
}

function disconnectedStatus() {
  return navigator.onLine ? 'reconnecting' : 'offline';
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
      if (!stopped) retry = setTimeout(fn, SOCKET_RETRY_MS);
    };
    async function start() {
      try {
        const { url, token: initialToken } = await socketCredentials();
        let firstToken: string | undefined = initialToken;
        if (stopped) return;
        socket = io(`${url.replace(/\/$/, '')}/ws`, {
          autoConnect: false,
          auth: (done) => {
            if (firstToken !== undefined) {
              const token = firstToken;
              firstToken = undefined;
              if (!stopped) done({ token });
              return;
            }
            // Повторний handshake бере свіжий access token, включно з refresh.
            socketCredentials()
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
          setStatus(disconnectedStatus());
          const serverDisconnected = reason === 'io server disconnect';
          if (serverDisconnected && navigator.onLine) {
            schedule(() => socket?.connect());
          }
        });
        socket.on('connect_error', () => {
          setStatus(disconnectedStatus());
          if (!socket?.active) schedule(() => socket?.connect());
        });
        socket.on('wallet.balance', (value: unknown) => {
          if (validWalletUpdate(value)) {
            callbacks.current.onWallet?.(value);
          } else {
            callbacks.current.onConnect?.();
          }
        });
        socket.on('transfer.status', (value: unknown) => {
          if (validTransferUpdate(value)) {
            callbacks.current.onTransfer?.(value);
          } else {
            callbacks.current.onConnect?.();
          }
        });
        socket.on('activity.created', (value: Activity) =>
          callbacks.current.onActivity?.(value),
        );
        socket.connect();
      } catch {
        if (!stopped) {
          setStatus(disconnectedStatus());
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
