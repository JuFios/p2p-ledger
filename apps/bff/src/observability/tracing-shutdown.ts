import { Injectable, OnApplicationShutdown } from '@nestjs/common';

let shutdown: (() => Promise<void>) | undefined;

export function registerTracingShutdown(callback: () => Promise<void>) {
  shutdown = callback;
}

@Injectable()
export class TracingShutdown implements OnApplicationShutdown {
  // Експортуємо останні span-и перед завершенням процесу.
  async onApplicationShutdown() {
    await shutdown?.();
  }
}
