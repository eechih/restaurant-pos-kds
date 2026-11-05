import { CONNECTION_STATE_CHANGE, ConnectionState } from 'aws-amplify/api';
import { generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import type { Schema } from '../../amplify/data/resource';
import {
  ConflictError,
  type Catalog,
  type GuestCheck,
  type KitchenTicket,
  type LineVoid,
  type LiveState,
  type Seating,
  type TicketStatus,
} from '../domain';
import type { Repository } from './repository';
import { sampleCatalog } from './sampleCatalog';

interface ModelResult<T> {
  data: T;
  errors?: readonly { message: string; errorType?: string }[];
  nextToken?: string | null;
}

function unwrap<T>({ data, errors }: ModelResult<T>): T {
  if (errors?.length) {
    if (errors.some((error) => error.errorType?.includes('ConditionalCheckFailed'))) {
      throw new ConflictError(errors[0].message);
    }
    throw new Error(errors.map((error) => error.message).join('; '));
  }
  return data;
}

async function listAll<T>(
  fetchPage: (nextToken?: string) => Promise<ModelResult<T[]>>,
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    items.push(...unwrap(page));
    nextToken = page.nextToken ?? undefined;
  } while (nextToken);
  return items;
}

const ignoreConflict = (error: unknown) => {
  if (!(error instanceof ConflictError)) throw error;
};

const toSeating = (raw: Schema['Seating']['type']): Seating => ({
  tableId: raw.tableId,
  checkId: raw.checkId,
});

const toCheck = (raw: Schema['GuestCheck']['type']): GuestCheck => ({
  id: raw.id,
  tableId: raw.tableId,
  tableName: raw.tableName,
  guestCount: raw.guestCount,
  status: raw.status,
  openedAt: raw.openedAt,
  paidAt: raw.paidAt,
  paymentMethod: raw.paymentMethod,
  total: raw.total,
});

const toTicket = (raw: Schema['KitchenTicket']['type']): KitchenTicket => ({
  id: raw.id,
  checkId: raw.checkId,
  tableName: raw.tableName,
  round: raw.round,
  status: raw.status,
  sentAt: raw.sentAt,
  lines: raw.lines,
});

const toVoid = (raw: Schema['LineVoid']['type']): LineVoid => ({
  id: raw.id,
  ticketId: raw.ticketId,
  checkId: raw.checkId,
  lineId: raw.lineId,
  reason: raw.reason,
  voidedAt: raw.voidedAt,
});

const byId = <T,>(items: T[], key: (item: T) => string): Record<string, T> =>
  Object.fromEntries(items.map((item) => [key(item), item]));

/** Call after Amplify.configure(). */
export function createAmplifyRepository(): Repository {
  const { models } = generateClient<Schema>();

  return {
    mode: 'amplify',

    async getCatalog(): Promise<Catalog> {
      const [tables, categories, items] = await Promise.all([
        listAll((nextToken) => models.DiningTable.list({ nextToken })),
        listAll((nextToken) => models.MenuCategory.list({ nextToken })),
        listAll((nextToken) => models.MenuItem.list({ nextToken })),
      ]);
      const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) =>
        a.sortOrder - b.sortOrder;
      return {
        tables: tables
          .map(({ id, name, seats, sortOrder }) => ({ id, name, seats, sortOrder }))
          .sort(bySortOrder),
        categories: categories
          .map(({ id, name, sortOrder }) => ({ id, name, sortOrder }))
          .sort(bySortOrder),
        items: items
          .map(({ id, categoryId, name, price, sortOrder, optionGroups }) => ({
            id,
            categoryId,
            name,
            price,
            sortOrder,
            optionGroups,
          }))
          .sort(bySortOrder),
      };
    },

    async seedCatalog() {
      const writes = [
        ...sampleCatalog.tables.map((table) => models.DiningTable.create(table)),
        ...sampleCatalog.categories.map((category) => models.MenuCategory.create(category)),
        ...sampleCatalog.items.map((item) => models.MenuItem.create(item)),
      ];
      await Promise.all(
        writes.map((write) =>
          (write as Promise<ModelResult<unknown>>).then(unwrap).catch(ignoreConflict),
        ),
      );
    },

    async loadLiveState(): Promise<LiveState> {
      const seatings = await listAll((nextToken) => models.Seating.list({ nextToken }));
      const openCheckIds = seatings.map((seating) => seating.checkId);

      const activeStatuses: TicketStatus[] = ['NEW', 'PREPARING', 'READY'];
      const [checks, checkTickets, activeTickets] = await Promise.all([
        Promise.all(openCheckIds.map(async (id) => unwrap(await models.GuestCheck.get({ id })))),
        Promise.all(
          openCheckIds.map((checkId) =>
            listAll((nextToken) => models.KitchenTicket.ticketsByCheck({ checkId }, { nextToken })),
          ),
        ),
        Promise.all(
          activeStatuses.map((status) =>
            listAll((nextToken) => models.KitchenTicket.ticketsByStatus({ status }, { nextToken })),
          ),
        ),
      ]);

      const tickets = [...checkTickets.flat(), ...activeTickets.flat()];
      const voidCheckIds = [...new Set([...openCheckIds, ...tickets.map((t) => t.checkId)])];
      const voids = await Promise.all(
        voidCheckIds.map((checkId) =>
          listAll((nextToken) => models.LineVoid.voidsByCheck({ checkId }, { nextToken })),
        ),
      );

      return {
        seatings: byId(seatings.map(toSeating), (seating) => seating.tableId),
        checks: byId(
          checks.flatMap((check) => (check ? [toCheck(check)] : [])),
          (check) => check.id,
        ),
        tickets: byId(tickets.map(toTicket), (ticket) => ticket.id),
        voids: byId(voids.flat().map(toVoid), (lineVoid) => lineVoid.id),
      };
    },

    subscribe({ onEvent, onConnection }) {
      const onError = () => onConnection(false);
      const subscriptions = [
        models.Seating.onCreate().subscribe({
          next: (raw) => onEvent({ type: 'seating/upsert', seating: toSeating(raw) }),
          error: onError,
        }),
        models.Seating.onDelete().subscribe({
          next: (raw) => onEvent({ type: 'seating/delete', tableId: raw.tableId }),
          error: onError,
        }),
        models.GuestCheck.onCreate().subscribe({
          next: (raw) => onEvent({ type: 'check/upsert', check: toCheck(raw) }),
          error: onError,
        }),
        models.GuestCheck.onUpdate().subscribe({
          next: (raw) => onEvent({ type: 'check/upsert', check: toCheck(raw) }),
          error: onError,
        }),
        models.KitchenTicket.onCreate().subscribe({
          next: (raw) => onEvent({ type: 'ticket/upsert', ticket: toTicket(raw) }),
          error: onError,
        }),
        models.KitchenTicket.onUpdate().subscribe({
          next: (raw) => onEvent({ type: 'ticket/upsert', ticket: toTicket(raw) }),
          error: onError,
        }),
        models.LineVoid.onCreate().subscribe({
          next: (raw) => onEvent({ type: 'void/upsert', lineVoid: toVoid(raw) }),
          error: onError,
        }),
      ];

      const stopListening = Hub.listen('api', ({ payload }) => {
        if (payload.event !== CONNECTION_STATE_CHANGE) return;
        const { connectionState } = payload.data as { connectionState: ConnectionState };
        onConnection(
          connectionState === ConnectionState.Connected ||
            connectionState === ConnectionState.ConnectedPendingKeepAlive,
        );
      });

      return () => {
        stopListening();
        subscriptions.forEach((subscription) => subscription.unsubscribe());
      };
    },

    async openTable({ tableId, tableName, guestCount }) {
      const created = unwrap(
        await models.GuestCheck.create({
          tableId,
          tableName,
          guestCount,
          status: 'OPEN',
          openedAt: new Date().toISOString(),
        }),
      );
      if (!created) throw new Error('failed to create check');
      try {
        unwrap(await models.Seating.create({ tableId, checkId: created.id }));
      } catch (error) {
        await models.GuestCheck.delete({ id: created.id });
        throw error;
      }
      return toCheck(created);
    },

    async sendTicket(ticket) {
      try {
        unwrap(await models.KitchenTicket.create(ticket));
      } catch (error) {
        ignoreConflict(error);
      }
    },

    async setTicketStatus(ticketId, status) {
      unwrap(await models.KitchenTicket.update({ id: ticketId, status }));
    },

    async voidLine(lineVoid) {
      try {
        unwrap(await models.LineVoid.create(lineVoid));
      } catch (error) {
        ignoreConflict(error);
      }
    },

    async payCheck({ checkId, paymentMethod, total }) {
      unwrap(
        await models.GuestCheck.update({
          id: checkId,
          status: 'PAID',
          paymentMethod,
          total,
          paidAt: new Date().toISOString(),
        }),
      );
    },

    async clearTable(tableId) {
      unwrap(await models.Seating.delete({ tableId }));
    },
  };
}
