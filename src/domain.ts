export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED';
/** EXPIRED is derived from expiresAt; stored orders are only PENDING or PAID. */
export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED';
export type PaymentMethod = 'CASH' | 'CARD';

export interface OptionChoice {
  id: string;
  name: string;
  priceDelta: number;
}
export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: OptionChoice[];
}
export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  sortOrder: number;
  optionGroups: OptionGroup[];
  /** False when sold out. Missing means available. */
  available?: boolean | null;
}
export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}
export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  sortOrder: number;
  /** What the table's QR code carries. Customers must never be able to read it. */
  qrToken?: string | null;
}
export interface Catalog {
  tables: DiningTable[];
  categories: MenuCategory[];
  items: MenuItem[];
}

export interface SelectedOption {
  groupName: string;
  choiceName: string;
  priceDelta: number;
}
export interface TicketLine {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  /** Base price plus option deltas, frozen when the line is created. */
  unitPrice: number;
  options: SelectedOption[];
  note?: string | null;
}
export interface Seating {
  tableId: string;
  checkId: string;
}
/** One party's stay at a table. Payment lives on each Order. */
export interface GuestCheck {
  id: string;
  tableId: string;
  tableName: string;
  /** Missing when the table was opened by a customer's first paid order. */
  guestCount?: number | null;
  openedAt: string;
}
export interface Order {
  id: string;
  tableId: string;
  tableName: string;
  /** Set when paid, because an unpaid order must not occupy a table. */
  checkId?: string | null;
  status: OrderStatus;
  lines: TicketLine[];
  total: number;
  createdAt: string;
  expiresAt: string;
  paymentMethod?: PaymentMethod | null;
  paidAt?: string | null;
}
export interface KitchenTicket {
  id: string;
  checkId: string;
  tableName: string;
  round: number;
  status: TicketStatus;
  sentAt: string;
  lines: TicketLine[];
}
export interface LineVoid {
  id: string;
  ticketId: string;
  checkId: string;
  lineId: string;
  reason: string;
  voidedAt: string;
}

/** Thrown when the server rejects a write because the record already exists. */
export class ConflictError extends Error {}

export type OrderRejection =
  | 'TABLE_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'INVALID_ITEMS'
  | 'PRICE_CHANGED'
  | 'TOO_MANY_PENDING'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_EXPIRED';

export const ORDER_REJECTION_MESSAGE: Record<OrderRejection, string> = {
  TABLE_NOT_FOUND: '找不到這張桌子',
  ITEM_UNAVAILABLE: '有品項已售完或已下架，請重新點餐',
  INVALID_ITEMS: '點餐內容有誤，請重新點餐',
  PRICE_CHANGED: '菜單價格已變更，請重新點餐',
  TOO_MANY_PENDING: '這桌尚未付款的訂單太多，請先到櫃台付款或稍後再試',
  ORDER_NOT_FOUND: '找不到這筆訂單',
  ORDER_EXPIRED: '這筆訂單已逾時，請重新操作',
};

/** Thrown when an order breaks a business rule. Retrying it will not help. */
export class OrderRejectedError extends Error {
  constructor(readonly code: OrderRejection) {
    super(code);
  }
}

export const voidId = (ticketId: string, lineId: string) => `${ticketId}#${lineId}`;

/** Fixed per order, so that confirming a payment twice cannot create two tickets. */
export const ticketIdForOrder = (orderId: string) => `order-${orderId}`;

/** A short code customers can read out at the counter. Unique enough within a table. */
export const orderCode = (orderId: string) => orderId.slice(0, 4).toUpperCase();

export interface LiveState {
  seatings: Record<string, Seating>;
  checks: Record<string, GuestCheck>;
  tickets: Record<string, KitchenTicket>;
  voids: Record<string, LineVoid>;
  orders: Record<string, Order>;
}
export const emptyLiveState: LiveState = {
  seatings: {},
  checks: {},
  tickets: {},
  voids: {},
  orders: {},
};

export type LiveEvent =
  | { type: 'seating/upsert'; seating: Seating }
  | { type: 'seating/delete'; tableId: string }
  | { type: 'check/upsert'; check: GuestCheck }
  | { type: 'ticket/upsert'; ticket: KitchenTicket }
  | { type: 'void/upsert'; lineVoid: LineVoid }
  | { type: 'order/upsert'; order: Order };

export function applyEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case 'seating/upsert':
      return { ...state, seatings: { ...state.seatings, [event.seating.tableId]: event.seating } };
    case 'seating/delete': {
      const seatings = { ...state.seatings };
      delete seatings[event.tableId];
      return { ...state, seatings };
    }
    case 'check/upsert':
      return { ...state, checks: { ...state.checks, [event.check.id]: event.check } };
    case 'ticket/upsert':
      return { ...state, tickets: { ...state.tickets, [event.ticket.id]: event.ticket } };
    case 'void/upsert':
      return { ...state, voids: { ...state.voids, [event.lineVoid.id]: event.lineVoid } };
    case 'order/upsert':
      return { ...state, orders: { ...state.orders, [event.order.id]: event.order } };
  }
}

export const lineAmount = (line: TicketLine) => line.unitPrice * line.quantity;

export const isLineVoided = (state: LiveState, ticketId: string, lineId: string) =>
  voidId(ticketId, lineId) in state.voids;

/** True when nothing on the ticket is left to cook or bill. */
export const isFullyVoided = (state: LiveState, ticket: KitchenTicket) =>
  ticket.lines.every((line) => isLineVoided(state, ticket.id, line.id));

export function ticketsForCheck(state: LiveState, checkId: string): KitchenTicket[] {
  return Object.values(state.tickets)
    .filter((ticket) => ticket.checkId === checkId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function billTotal(state: LiveState, checkId: string): number {
  return ticketsForCheck(state, checkId).reduce(
    (sum, ticket) =>
      sum +
      ticket.lines
        .filter((line) => !isLineVoided(state, ticket.id, line.id))
        .reduce((lineSum, line) => lineSum + lineAmount(line), 0),
    0,
  );
}

export const unservedTickets = (state: LiveState, checkId: string) =>
  ticketsForCheck(state, checkId).filter(
    (ticket) => ticket.status !== 'SERVED' && !isFullyVoided(state, ticket),
  );

/** The next round number. Concurrent sends may share one; it is only a label. */
export const nextRound = (state: LiveState, checkId: string) =>
  ticketsForCheck(state, checkId).reduce((max, ticket) => Math.max(max, ticket.round), 0) + 1;

export function ticketsWithStatus(state: LiveState, statuses: TicketStatus[]): KitchenTicket[] {
  return Object.values(state.tickets)
    .filter((ticket) => statuses.includes(ticket.status))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export type TableState = 'EMPTY' | 'DINING';

export const tableState = (state: LiveState, tableId: string): TableState =>
  state.seatings[tableId] ? 'DINING' : 'EMPTY';

export const effectiveOrderStatus = (
  order: Pick<Order, 'status' | 'expiresAt'>,
  now: number,
): OrderStatus =>
  order.status === 'PENDING' && new Date(order.expiresAt).getTime() <= now
    ? 'EXPIRED'
    : order.status;

/** Orders waiting for payment, oldest first. */
export const pendingOrders = (state: LiveState, now: number): Order[] =>
  Object.values(state.orders)
    .filter((order) => effectiveOrderStatus(order, now) === 'PENDING')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** Selected choice ids, keyed by option group id. */
export type OptionSelection = Record<string, string[]>;

export function missingRequiredGroups(item: MenuItem, selection: OptionSelection): OptionGroup[] {
  return item.optionGroups.filter((group) => group.required && !selection[group.id]?.length);
}

export function selectedOptions(item: MenuItem, selection: OptionSelection): SelectedOption[] {
  return item.optionGroups.flatMap((group) =>
    group.choices
      .filter((choice) => selection[group.id]?.includes(choice.id))
      .map((choice) => ({
        groupName: group.name,
        choiceName: choice.name,
        priceDelta: choice.priceDelta,
      })),
  );
}

export const unitPriceOf = (item: MenuItem, selection: OptionSelection) =>
  selectedOptions(item, selection).reduce((sum, option) => sum + option.priceDelta, item.price);

export function toggleChoice(
  selection: OptionSelection,
  group: OptionGroup,
  choiceId: string,
): OptionSelection {
  const current = selection[group.id] ?? [];
  const isSelected = current.includes(choiceId);
  let next: string[];
  if (group.multiple) {
    next = isSelected ? current.filter((id) => id !== choiceId) : [...current, choiceId];
  } else if (isSelected) {
    next = group.required ? current : [];
  } else {
    next = [choiceId];
  }
  return { ...selection, [group.id]: next };
}

export function buildLine(
  id: string,
  item: MenuItem,
  selection: OptionSelection,
  quantity: number,
  note: string,
): TicketLine {
  return {
    id,
    menuItemId: item.id,
    name: item.name,
    quantity,
    unitPrice: unitPriceOf(item, selection),
    options: selectedOptions(item, selection),
    note: note.trim() || null,
  };
}

export interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  choiceIds: string[];
  note?: string | null;
}

export const ORDER_LIFETIME_MS = 15 * 60_000;
/**
 * Anyone holding a table's QR link can order without signing in, so this keeps
 * one link from flooding the staff's pending list. Unpaid orders expire, so a
 * table that reaches it recovers by itself.
 */
export const MAX_PENDING_ORDERS_PER_TABLE = 10;
const MAX_ORDER_LINES = 50;
const MAX_LINE_QUANTITY = 99;
const MAX_NOTE_LENGTH = 200;

function selectionFromChoiceIds(item: MenuItem, choiceIds: string[]): OptionSelection {
  const selection: OptionSelection = {};
  for (const choiceId of new Set(choiceIds)) {
    const group = item.optionGroups.find((candidate) =>
      candidate.choices.some((choice) => choice.id === choiceId),
    );
    if (!group) throw new OrderRejectedError('INVALID_ITEMS');
    selection[group.id] = [...(selection[group.id] ?? []), choiceId];
    if (!group.multiple && selection[group.id].length > 1) {
      throw new OrderRejectedError('INVALID_ITEMS');
    }
  }
  return selection;
}

/**
 * Turns what a customer asked for into priced lines. The input may come from an
 * untrusted device, so it is checked here and carries no prices of its own.
 */
export function priceOrder(
  menu: MenuItem[],
  inputs: OrderItemInput[],
  newLineId: () => string,
): { lines: TicketLine[]; total: number } {
  if (inputs.length === 0 || inputs.length > MAX_ORDER_LINES) {
    throw new OrderRejectedError('INVALID_ITEMS');
  }
  const lines = inputs.map(({ menuItemId, quantity, choiceIds, note }) => {
    const item = menu.find((candidate) => candidate.id === menuItemId);
    if (!item || item.available === false) throw new OrderRejectedError('ITEM_UNAVAILABLE');
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY ||
      (note?.length ?? 0) > MAX_NOTE_LENGTH
    ) {
      throw new OrderRejectedError('INVALID_ITEMS');
    }
    const selection = selectionFromChoiceIds(item, choiceIds);
    if (missingRequiredGroups(item, selection).length > 0) {
      throw new OrderRejectedError('INVALID_ITEMS');
    }
    return buildLine(newLineId(), item, selection, quantity, note ?? '');
  });
  return { lines, total: lines.reduce((sum, line) => sum + lineAmount(line), 0) };
}

export const formatMoney = (amount: number) => `NT$${amount.toLocaleString('en-US')}`;

export const elapsedMinutes = (fromIso: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
