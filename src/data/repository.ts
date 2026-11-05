import type {
  Catalog,
  GuestCheck,
  KitchenTicket,
  LineVoid,
  LiveEvent,
  LiveState,
  PaymentMethod,
  TicketStatus,
} from '../domain';

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onConnection(online: boolean): void;
}

/** Implemented by AWS Amplify, and by browser storage for local demo mode. */
export interface Repository {
  readonly mode: 'amplify' | 'demo';
  getCatalog(): Promise<Catalog>;
  seedCatalog(): Promise<void>;
  loadLiveState(): Promise<LiveState>;
  subscribe(handlers: LiveHandlers): () => void;
  /** Rejects with ConflictError when the table is already occupied. */
  openTable(input: { tableId: string; tableName: string; guestCount: number }): Promise<GuestCheck>;
  /** Safe to retry with the same ticket id. */
  sendTicket(ticket: KitchenTicket): Promise<void>;
  setTicketStatus(ticketId: string, status: TicketStatus): Promise<void>;
  /** Safe to retry; voiding a voided line changes nothing. */
  voidLine(lineVoid: LineVoid): Promise<void>;
  payCheck(input: { checkId: string; paymentMethod: PaymentMethod; total: number }): Promise<void>;
  clearTable(tableId: string): Promise<void>;
  resetDemo?(): void;
}
