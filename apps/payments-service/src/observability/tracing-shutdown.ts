import { Injectable, OnApplicationShutdown } from '@nestjs/common';

let shutdown: (() => Promise<void>) | undefined;

export function registerTracingShutdown(callback: () => Promise<void>) {
  shutdown = callback;
}

@Injectable()
export class TracingShutdown implements OnApplicationShutdown {
  // Після завершення воркерів експортуємо й останні span-и.
  async onApplicationShutdown() {
    await shutdown?.();
  }
}
