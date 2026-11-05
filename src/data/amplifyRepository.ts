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
  type LiveEvent,
  type LiveState,
  type Order,
  type Seating,
  type TicketStatus,
} from '../domain';
import { listAll, type ModelResult, toCategories, toMenuItems, unwrap } from './amplifyHelpers';
import type { Repository } from './repository';
import { sampleCatalog } from './sampleCatalog';

const ignoreConflict = (error: unknown) => {
  if (!(error instanceof ConflictError)) throw error;
};

const toSeating = (raw: Schema['Seating']['type']): Seating => ({
  tableId: raw.tableId,
  checkId: raw.checkId,
});

const toCheck = (raw: Schema['CheckRecord']['type'] & { guestCount?: number | null }): GuestCheck => ({
  id: raw.id,
  tableId: raw.tableId,
  tableName: raw.tableName,
  guestCount: raw.guestCount,
  openedAt: raw.openedAt,
});

const toOrder = (raw: Schema['OrderRecord']['type']): Order => ({
  id: raw.id,
  tableId: raw.tableId,
  tableName: raw.tableName,
  checkId: raw.checkId,
  status: raw.status,
  lines: raw.lines,
  total: raw.total,
  createdAt: raw.createdAt,
  expiresAt: raw.expiresAt,
  paymentMethod: raw.paymentMethod,
  paidAt: raw.paidAt,
});

const toTicket = (raw: Schema['TicketRecord']['type']): KitchenTicket => ({
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

const paymentEvents = ({
  order,
  ticket,
  check,
}: NonNullable<Schema['PaymentConfirmation']['type']>): LiveEvent[] => [
  ...(check ? [{ type: 'check/upsert', check: toCheck(check) } as const] : []),
  { type: 'seating/upsert', seating: { tableId: order.tableId, checkId: ticket.checkId } },
  { type: 'order/upsert', order: toOrder(order) },
  { type: 'ticket/upsert', ticket: toTicket(ticket) },
];

const byId = <T,>(items: T[], key: (item: T) => string): Record<string, T> =>
  Object.fromEntries(items.map((item) => [key(item), item]));

/** Call after Amplify.configure(). */
export function createAmplifyRepository(): Repository {
  const { models, mutations, subscriptions: customSubscriptions } = generateClient<Schema>();

  return {
    mode: 'amplify',

    async getCatalog(): Promise<Catalog> {
      const [tables, categories, items] = await Promise.all([
        listAll((nextToken) => models.DiningTable.list({ nextToken })),
        listAll((nextToken) => models.MenuCategory.list({ nextToken })),
        listAll((nextToken) => models.MenuItem.list({ nextToken })),
      ]);
      return {
        tables: tables
          .map(({ id, name, seats, sortOrder, qrToken }) => ({ id, name, seats, sortOrder, qrToken }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
        categories: toCategories(categories),
        items: toMenuItems(items),
      };
    },

    async seedCatalog() {
      const writes = [
        ...sampleCatalog.tables.map((table) =>
          models.DiningTable.create({ ...table, qrToken: crypto.randomUUID() }),
        ),
        ...sampleCatalog.categories.map((category) => models.MenuCategory.create(category)),
        ...sampleCatalog.items.map((item) => models.MenuItem.create(item)),
      ];
      await Promise.all(
        writes.map((write) =>
          (write as Promise<ModelResult<unknown>>).then(unwrap).catch(ignoreConflict),
        ),
      );
    },

    async rotateTableToken(tableId) {
      unwrap(await models.DiningTable.update({ id: tableId, qrToken: crypto.randomUUID() }));
    },

    async loadLiveState(): Promise<LiveState> {
      const seatings = await listAll((nextToken) => models.Seating.list({ nextToken }));
      const openCheckIds = seatings.map((seating) => seating.checkId);

      const activeStatuses: TicketStatus[] = ['NEW', 'PREPARING', 'READY'];
      const [orders, checks, checkTickets, activeTickets] = await Promise.all([
        listAll((nextToken) => models.Order.ordersByStatus({ status: 'PENDING' }, { nextToken })),
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
        orders: byId(orders.map(toOrder), (order) => order.id),
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
        // A failed mutation still notifies, with an empty result, and the caller
        // chooses which fields a result carries. Customers can call placeOrder, so
        // its result is checked, and the minute resync recovers anything skipped.
        customSubscriptions.onOrderPlaced().subscribe({
          next: (order) => {
            if (order?.status === 'PENDING' && order.lines) {
              onEvent({ type: 'order/upsert', order: toOrder(order) });
            }
          },
          error: onError,
        }),
        customSubscriptions.onOrderPaid().subscribe({
          next: (confirmation) => {
            if (confirmation?.order && confirmation.ticket) {
              paymentEvents(confirmation).forEach(onEvent);
            }
          },
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

    async placeStaffOrder(input) {
      unwrap(await mutations.placeStaffOrder(input));
    },

    async confirmOrderPayment(orderId, paymentMethod) {
      const confirmation = unwrap(await mutations.confirmOrderPayment({ orderId, paymentMethod }));
      if (!confirmation) throw new Error('failed to confirm payment');
      return paymentEvents(confirmation);
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

    async clearTable(tableId) {
      unwrap(await models.Seating.delete({ tableId }));
    },
  };
}
