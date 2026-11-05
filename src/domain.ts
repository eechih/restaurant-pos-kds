export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED';
export type CheckStatus = 'OPEN' | 'PAID';
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
export interface GuestCheck {
  id: string;
  tableId: string;
  tableName: string;
  guestCount: number;
  status: CheckStatus;
  openedAt: string;
  paidAt?: string | null;
  paymentMethod?: PaymentMethod | null;
  total?: number | null;
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

export const voidId = (ticketId: string, lineId: string) => `${ticketId}#${lineId}`;

export interface LiveState {
  seatings: Record<string, Seating>;
  checks: Record<string, GuestCheck>;
  tickets: Record<string, KitchenTicket>;
  voids: Record<string, LineVoid>;
}
export const emptyLiveState: LiveState = { seatings: {}, checks: {}, tickets: {}, voids: {} };

export type LiveEvent =
  | { type: 'seating/upsert'; seating: Seating }
  | { type: 'seating/delete'; tableId: string }
  | { type: 'check/upsert'; check: GuestCheck }
  | { type: 'ticket/upsert'; ticket: KitchenTicket }
  | { type: 'void/upsert'; lineVoid: LineVoid };

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

export type TableState = 'EMPTY' | 'DINING' | 'PAID';

export function tableState(state: LiveState, tableId: string): TableState {
  const seating = state.seatings[tableId];
  if (!seating) return 'EMPTY';
  return state.checks[seating.checkId]?.status === 'PAID' ? 'PAID' : 'DINING';
}

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

export const formatMoney = (amount: number) => `NT$${amount.toLocaleString('en-US')}`;

export const elapsedMinutes = (fromIso: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
