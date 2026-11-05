import type {
  Catalog,
  GuestCheck,
  LineVoid,
  LiveEvent,
  LiveState,
  OrderItemInput,
  PaymentMethod,
  TicketStatus,
} from '../domain';

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onConnection(online: boolean): void;
}

/** Staff access. Implemented by AWS Amplify, and by browser storage for local demo mode. */
export interface Repository {
  readonly mode: 'amplify' | 'demo';
  getCatalog(): Promise<Catalog>;
  seedCatalog(): Promise<void>;
  /** Issues a new QR token for the table, which stops its old QR code working. */
  rotateTableToken(tableId: string): Promise<void>;
  loadLiveState(): Promise<LiveState>;
  subscribe(handlers: LiveHandlers): () => void;
  /** Rejects with ConflictError when the table is already occupied. */
  openTable(input: { tableId: string; tableName: string; guestCount: number }): Promise<GuestCheck>;
  /**
   * Safe to retry with the same order id. The server sets the prices, and rejects
   * with OrderRejectedError when they differ from expectedTotal.
   */
  placeStaffOrder(input: {
    orderId: string;
    tableId: string;
    items: OrderItemInput[];
    expectedTotal: number;
  }): Promise<void>;
  /**
   * Marks the order paid and sends it to the kitchen as one atomic step, opening
   * the table if needed. Safe to retry. Resolves to the resulting changes.
   */
  confirmOrderPayment(orderId: string, paymentMethod: PaymentMethod): Promise<LiveEvent[]>;
  setTicketStatus(ticketId: string, status: TicketStatus): Promise<void>;
  /** Safe to retry; voiding a voided line changes nothing. */
  voidLine(lineVoid: LineVoid): Promise<void>;
  clearTable(tableId: string): Promise<void>;
  resetDemo?(): void;
}
