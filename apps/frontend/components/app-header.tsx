'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLiveSocket } from '@/lib/use-live-socket';
import { Badge, Brand, Button } from './ui/index';
import { LiveStatus } from './live-status';

interface HeaderProps { email: string; role?: string; links: { href: string; label: string }[] }
export function AppHeader(props: HeaderProps) {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/register' || !props.email) return null;
  return <Navigation {...props} pathname={pathname}/>;
}
function Navigation({ email, role, links, pathname }: HeaderProps & { pathname: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const status = useLiveSocket({});
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const outside = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) close(); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  const items = links.map(({ href, label }) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return <a key={href} href={href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)} className={`rounded-lg px-3 py-3 text-sm font-medium ${active ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-canvas hover:text-ink'}`}>{label}</a>;
  });
  return <header ref={header} className="border-b bg-surface"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8"><a href="/wallets" aria-label="P2P Ledger — гаманці" className="shrink-0 rounded-lg"><Brand/></a><nav aria-label="Головна навігація" className="hidden gap-1 xl:flex">{items}</nav><div className="flex items-center gap-3"><div className="hidden text-right xl:block"><p className="max-w-44 truncate text-xs font-medium" title={email}>{email}</p><div className="mt-1"><Badge tone={role === 'admin' ? 'info' : 'neutral'}>{role === 'admin' ? 'Адміністратор' : 'Особистий рахунок'}</Badge></div></div><LiveStatus status={status}/><form method="post" action="/api/auth/logout" className="hidden xl:block"><Button type="submit" variant="ghost">Вийти</Button></form><button ref={button} type="button" aria-label={open ? 'Закрити меню' : 'Відкрити меню'} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(!open)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border xl:hidden"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{open ? <path d="m6 6 12 12M6 18 18 6"/> : <path d="M4 6h16M4 12h16M4 18h16"/>}</svg></button></div></div>{open && <div id="mobile-menu" className="border-t px-4 pb-4 pt-2 xl:hidden"><nav aria-label="Мобільна навігація" className="grid gap-1">{items}</nav><div className="mt-3 flex items-center justify-between gap-3 border-t pt-4"><div className="min-w-0"><p className="truncate text-sm" title={email}>{email}</p><p className="muted mt-1">{role === 'admin' ? 'Адміністратор' : 'Особистий рахунок'}</p></div><form method="post" action="/api/auth/logout"><Button variant="secondary">Вийти</Button></form></div></div>}</header>;
}
