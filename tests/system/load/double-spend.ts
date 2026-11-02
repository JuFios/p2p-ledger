import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  admin,
  assertBalance,
  assertEventBalances,
  events,
  readWallet,
  reconcile,
  send,
  terminal,
  user,
  wallet,
} from '../helpers';

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    Math.round(sorted[Math.ceil(p * sorted.length) - 1]);
  return {
    min: Math.round(sorted[0]),
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

async function main() {
  const adminToken = await admin();
  const sender = await user();
  const recipient = await user();
  const from = await wallet(sender, 'USD', 100);
  const to = await wallet(recipient, 'USD');
  const requestCount = 50;
  const start = performance.now();
  const finals = await Promise.all(
    Array.from({ length: requestCount }, async () => {
      const began = performance.now();
      const response = await send(sender, from, recipient, 10);
      assert.equal(response.status, 202);
      const acceptedMs = performance.now() - began;
      const result = await terminal(sender, response.body.id);
      return {
        result,
        acceptedMs,
        terminalMs: performance.now() - began,
      };
    }),
  );
  assert.equal(new Set(finals.map((f) => f.result.id)).size, requestCount);
  const elapsed = performance.now() - start;
  const completed = finals.filter((f) => f.result.status === 'COMPLETED');
  const failed = finals.filter((f) => f.result.status === 'FAILED');
  assert.equal(completed.length, 10);
  assert.equal(failed.length, 40);
  for (const f of failed) {
    assert.equal(f.result.failureReason, 'INSUFFICIENT_FUNDS');
    assert.equal(f.result.step, 'HOLD');
  }
  const senderWallet = await readWallet(sender, from.id);
  const recipientWallet = await readWallet(recipient, to.id);
  assertBalance(senderWallet, 0n);
  assertBalance(recipientWallet, 10000n);
  const log = await events(adminToken, from.id);
  for (const type of ['TransferInitiated', 'HoldPlaced', 'TransferCompleted']) {
    assert.equal(log.filter((e) => e.type === type).length, 10, type);
  }
  assert.equal(log.filter((e) => e.type === 'HoldReleased').length, 0);
  assertEventBalances(log, senderWallet);
  assertEventBalances(await events(adminToken, to.id), recipientWallet);
  const reconciliation = await reconcile(adminToken);
  console.table([
    {
      status: 'COMPLETED',
      count: completed.length,
      reason: '',
      balance: recipientWallet.balance,
    },
    {
      status: 'FAILED',
      count: failed.length,
      reason: 'INSUFFICIENT_FUNDS',
      balance: senderWallet.balance,
    },
  ]);
  console.table({
    'POST /transfers (ms)': distribution(finals.map((f) => f.acceptedMs)),
    'POST to observed terminal (ms)': distribution(
      finals.map((f) => f.terminalMs),
    ),
  });
  console.log(
    JSON.stringify({
      requests: finals.length,
      completed: completed.length,
      failed: failed.length,
      senderAvailable: senderWallet.available,
      senderHeld: senderWallet.held,
      recipientBalance: recipientWallet.balance,
      reconciliation: reconciliation.ok,
      elapsedMs: Math.round(elapsed),
      terminalPerSecond: Number(((finals.length * 1000) / elapsed).toFixed(2)),
    }),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
