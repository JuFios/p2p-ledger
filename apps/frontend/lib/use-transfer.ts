'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clientFetch } from './http';
import { isFinal, Transfer, TransferUpdate } from './types';

export function useTransfer() {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(transfer);
  current.current = transfer;
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const value = current.current;
    if (!value) return;
    const request = ++revision.current;
    try {
      const result = await clientFetch<Transfer>(`/transfers/${value.id}`);
      if (request === revision.current && current.current?.id === value.id) {
        setTransfer(result);
        setError(null);
      }
    } catch (err) {
      if (request === revision.current) setError((err as Error).message);
    }
  }, []);
  const update = useCallback(
    (value: TransferUpdate) => {
      if (current.current?.id !== value.transferId || isFinal(current.current))
        return;
      revision.current++;
      setTransfer((old) =>
        old
          ? { ...old, ...value, failureReason: value.failureReason ?? null }
          : old,
      );
      void refresh();
    },
    [refresh],
  );
  const track = (value: Transfer | null) => {
    revision.current++;
    current.current = value;
    setTransfer(value);
    setError(null);
  };
  const id = transfer?.id;
  const final = transfer ? isFinal(transfer) : false;
  useEffect(() => {
    if (!id || final) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, final, refresh]);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  return { transfer, track, refresh, update, error };
}
