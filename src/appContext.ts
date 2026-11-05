import { createContext, useCallback, useContext, useState } from 'react';
import type { LiveStatus } from './data/useLiveState';
import {
  ORDER_REJECTION_MESSAGE,
  OrderRejectedError,
  type Catalog,
  type GuestCheck,
  type KitchenTicket,
  type LineVoid,
  type Order,
  type OrderItemInput,
  type PaymentMethod,
  type TicketLine,
  type TicketStatus,
} from './domain';

export interface DraftLine extends TicketLine {
  choiceIds: string[];
}

/**
 * Lines not yet ordered. The order id is kept so a retried payment cannot
 * duplicate, and changes whenever the lines do, because a retry returns the
 * order as first placed.
 */
export interface Draft {
  orderId: string;
  lines: DraftLine[];
}

export interface Actions {
  seedCatalog(): Promise<void>;
  rotateTableToken(tableId: string): Promise<void>;
  openTable(input: { tableId: string; tableName: string; guestCount: number }): Promise<GuestCheck>;
  /** Takes payment for a staff-entered order and sends it to the kitchen. */
  placeAndPay(
    order: { orderId: string; tableId: string; items: OrderItemInput[]; expectedTotal: number },
    paymentMethod: PaymentMethod,
  ): Promise<void>;
  /** Takes payment for a customer's order and sends it to the kitchen. */
  confirmOrderPayment(order: Order, paymentMethod: PaymentMethod): Promise<void>;
  setTicketStatus(ticket: KitchenTicket, status: TicketStatus): Promise<void>;
  voidLine(lineVoid: LineVoid): Promise<void>;
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
        notify(
          error instanceof OrderRejectedError
            ? ORDER_REJECTION_MESSAGE[error.code]
            : `${failureMessage}，請再試一次`,
          true,
        );
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  return { busy, run };
}
