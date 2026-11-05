import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { LiveStatus } from './data/useLiveState';
import type {
  Catalog,
  GuestCheck,
  KitchenTicket,
  LineVoid,
  PaymentMethod,
  TicketLine,
  TicketStatus,
} from './domain';

/** Lines not yet sent. The ticket id is kept so a retried send cannot duplicate. */
export interface Draft {
  ticketId: string;
  lines: TicketLine[];
}

export interface Actions {
  seedCatalog(): Promise<void>;
  openTable(input: { tableId: string; tableName: string; guestCount: number }): Promise<GuestCheck>;
  sendTicket(ticket: KitchenTicket): Promise<void>;
  setTicketStatus(ticket: KitchenTicket, status: TicketStatus): Promise<void>;
  voidLine(lineVoid: LineVoid): Promise<void>;
  payCheck(check: GuestCheck, paymentMethod: PaymentMethod, total: number): Promise<void>;
  clearTable(tableId: string): Promise<void>;
}

export interface AppContextValue {
  catalog: Catalog;
  catalogState: 'loading' | 'ready' | 'failed';
  live: LiveStatus;
  actions: Actions;
  drafts: Record<string, Draft>;
  setDraft(checkId: string, draft: Draft | undefined): void;
  notify(message: string, isError?: boolean): void;
}

export const emptyCatalog: Catalog = { tables: [], categories: [], items: [] };

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext');
  return value;
}

/** Runs a write, reports failure to the user, and blocks repeat taps meanwhile. */
export function useAction() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: () => Promise<void>, failureMessage: string) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        console.error(failureMessage, error);
        notify(`${failureMessage}，請再試一次`, true);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  return { busy, run };
}

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
