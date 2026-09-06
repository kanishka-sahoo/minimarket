import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { User } from '@minimarket/shared';
export async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const base =
    typeof window === 'undefined' ? (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000') : '';
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined
        ? {}
        : { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not complete your request');
  return data as T;
}
export function useSession() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User | null; googleEnabled: boolean }>('/api/me'),
    enabled: mounted,
    retry: 1,
    staleTime: 30000,
  });
}
export function useAction<T = unknown>() {
  const client = useQueryClient();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  return useMutation({
    mutationFn: async ({ path, body }: { path: string; body: unknown }) => {
      const fingerprint = JSON.stringify({ path, body });
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api<T>(path, body, retry.current.key);
      retry.current = null;
      return result;
    },
    onSuccess: () => client.invalidateQueries(),
  });
}
export function useLive(id: string) {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout>;
    let lastVersion: number | null = null;
    const synchronize = async (ws: WebSocket) => {
      try {
        const state = await client.fetchQuery({
          queryKey: ['market', id],
          queryFn: () => api<import('@minimarket/shared').Snapshot>('/api/markets/' + id),
          staleTime: 0,
        });
        lastVersion = state.market.version;
        await Promise.all([
          client.invalidateQueries({ queryKey: ['portfolio'] }),
          client.invalidateQueries({ queryKey: ['me'] }),
          client.invalidateQueries({ queryKey: ['pages'] }),
        ]);
        if (!disposed && socket === ws && ws.readyState === WebSocket.OPEN) setConnected(true);
      } catch {
        if (socket === ws) setConnected(false);
        ws.close();
      }
    };
    const connect = () => {
      if (disposed || document.hidden || (socket && socket.readyState <= WebSocket.OPEN)) return;
      setConnected(false);
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/${id}`,
      );
      socket = ws;
      ws.onopen = () => {
        void synchronize(ws);
      };
      ws.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as { version: number };
          if (!Number.isInteger(update.version)) return;
          if (lastVersion === null || update.version > lastVersion) {
            if (lastVersion !== null && update.version > lastVersion + 1) setConnected(false);
            void synchronize(ws);
          }
        } catch {
          ws.close();
        }
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        setConnected(false);
        if (!disposed && !document.hidden) reconnect = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    const visibility = () => {
      clearTimeout(reconnect);
      if (document.hidden) {
        setConnected(false);
        socket?.close();
      } else connect();
    };
    document.addEventListener('visibilitychange', visibility);
    connect();
    const timer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN && !document.hidden) socket.send('active');
    }, 20000);
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      socket?.close();
    };
  }, [id, client]);
  return connected;
}
