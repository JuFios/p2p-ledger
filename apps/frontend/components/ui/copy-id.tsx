'use client';
import { useState } from 'react';

export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" title={value} aria-label={`Копіювати ID ${value}`} className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md px-1 font-mono text-xs text-muted hover:text-accent" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); } }}><span>{value.slice(0, 8)}…{value.slice(-4)}</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 4H5a1 1 0 0 0-1 1v7"/></svg><span className="sr-only" role="status">{copied ? 'Скопійовано' : ''}</span></button>;
}
