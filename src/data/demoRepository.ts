import {
  applyEvent,
  ConflictError,
  emptyLiveState,
  type Catalog,
  type GuestCheck,
  type LiveEvent,
  type LiveState,
} from '../domain';
import type { Repository } from './repository';
import { sampleCatalog } from './sampleCatalog';

const STORAGE_KEY = 'pos-kds-demo-v1';
const CHANNEL = 'pos-kds-demo';

interface DemoData {
  catalog: Catalog;
  live: LiveState;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keeps data in browser storage and syncs tabs on this device. */
export function createDemoRepository(storage: KeyValueStore = localStorage): Repository {
  const read = (): DemoData => {
    const raw = storage.getItem(STORAGE_KEY);
    return raw
      ? (JSON.parse(raw) as DemoData)
      : { catalog: { tables: [], categories: [], items: [] }, live: emptyLiveState };
  };
  const write = (data: DemoData) => storage.setItem(STORAGE_KEY, JSON.stringify(data));

  const commit = (event: LiveEvent) => {
    const data = read();
    write({ ...data, live: applyEvent(data.live, event) });
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(event);
    channel.close();
  };

  return {
    mode: 'demo',
    async getCatalog() {
      return read().catalog;
    },
    async seedCatalog() {
      write({ ...read(), catalog: sampleCatalog });
    },
    async loadLiveState() {
      return read().live;
    },
    subscribe({ onEvent, onConnection }) {
      const channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (message: MessageEvent<LiveEvent>) => onEvent(message.data);
      onConnection(true);
      return () => channel.close();
    },
    async openTable({ tableId, tableName, guestCount }) {
      if (read().live.seatings[tableId]) throw new ConflictError('table already occupied');
      const check: GuestCheck = {
        id: crypto.randomUUID(),
        tableId,
        tableName,
        guestCount,
        status: 'OPEN',
        openedAt: new Date().toISOString(),
      };
      commit({ type: 'check/upsert', check });
      commit({ type: 'seating/upsert', seating: { tableId, checkId: check.id } });
      return check;
    },
    async sendTicket(ticket) {
      if (read().live.tickets[ticket.id]) return;
      commit({ type: 'ticket/upsert', ticket });
    },
    async setTicketStatus(ticketId, status) {
      const ticket = read().live.tickets[ticketId];
      if (!ticket) throw new Error(`unknown ticket ${ticketId}`);
      commit({ type: 'ticket/upsert', ticket: { ...ticket, status } });
    },
    async voidLine(lineVoid) {
      if (read().live.voids[lineVoid.id]) return;
      commit({ type: 'void/upsert', lineVoid });
    },
    async payCheck({ checkId, paymentMethod, total }) {
      const check = read().live.checks[checkId];
      if (!check) throw new Error(`unknown check ${checkId}`);
      commit({
        type: 'check/upsert',
        check: { ...check, status: 'PAID', paymentMethod, total, paidAt: new Date().toISOString() },
      });
    },
    async clearTable(tableId) {
      commit({ type: 'seating/delete', tableId });
    },
    resetDemo() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}
