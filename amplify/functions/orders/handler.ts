import { randomUUID } from 'node:crypto';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  effectiveOrderStatus,
  ORDER_LIFETIME_MS,
  OrderRejectedError,
  priceOrder,
  ticketIdForOrder,
  type KitchenTicket,
  type MenuItem,
  type Order,
  type OrderItemInput,
  type PaymentMethod,
} from '../../../src/domain';

const db = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = (name: string) => {
  const value = process.env[`${name}_TABLE`];
  if (!value) throw new Error(`missing table name for ${name}`);
  return value;
};
const TABLES = {
  dining: tableName('DININGTABLE'),
  menu: tableName('MENUITEM'),
  order: tableName('ORDER'),
  ticket: tableName('KITCHENTICKET'),
  check: tableName('GUESTCHECK'),
  seating: tableName('SEATING'),
};

/** Amplify's data API expects these on every record it reads. */
const record = (typename: string, now: string) => ({
  __typename: typename,
  createdAt: now,
  updatedAt: now,
});

const getItem = async <T>(TableName: string, Key: Record<string, string>) =>
  (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item as T | undefined;

async function getOrder(orderId: string) {
  return getItem<Order>(TABLES.order, { id: orderId });
}

async function toCustomerOrder(order: Order) {
  const status = effectiveOrderStatus(order, Date.now());
  const ticket =
    status === 'PAID'
      ? await getItem<KitchenTicket>(TABLES.ticket, { id: ticketIdForOrder(order.id) })
      : undefined;
  return {
    id: order.id,
    tableId: order.tableId,
    tableName: order.tableName,
    status,
    lines: order.lines,
    total: order.total,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    ticketStatus: ticket?.status,
  };
}

async function getMenuItems(items: OrderItemInput[]): Promise<MenuItem[]> {
  // The request is checked for size in priceOrder, but that needs the menu first.
  if (items.length === 0 || items.length > 50) throw new OrderRejectedError('INVALID_ITEMS');
  const ids = [...new Set(items.map((item) => item.menuItemId))];
  const { Responses } = await db.send(
    new BatchGetCommand({
      RequestItems: { [TABLES.menu]: { Keys: ids.map((id) => ({ id })) } },
    }),
  );
  return (Responses?.[TABLES.menu] ?? []) as MenuItem[];
}

async function createOrder(
  orderId: string,
  table: { id: string; name: string } | undefined,
  items: OrderItemInput[],
  expectedTotal: number,
) {
  const existing = await getOrder(orderId);
  if (existing) return toCustomerOrder(existing);
  if (!table) throw new OrderRejectedError('TABLE_NOT_FOUND');

  const { lines, total } = priceOrder(await getMenuItems(items), items, randomUUID);
  if (total !== expectedTotal) throw new OrderRejectedError('PRICE_CHANGED');

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const order: Order = {
    id: orderId,
    tableId: table.id,
    tableName: table.name,
    status: 'PENDING',
    lines,
    total,
    createdAt,
    expiresAt: new Date(now + ORDER_LIFETIME_MS).toISOString(),
  };
  try {
    await db.send(
      new PutCommand({
        TableName: TABLES.order,
        Item: { ...record('Order', createdAt), ...order },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    // A concurrent retry got there first.
    if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
    const winner = await getOrder(orderId);
    if (!winner) throw error;
    return toCustomerOrder(winner);
  }
  return toCustomerOrder(order);
}

async function nextRoundForCheck(checkId: string) {
  const { Items } = await db.send(
    new QueryCommand({
      TableName: TABLES.ticket,
      IndexName: 'kitchenTicketsByCheckId',
      KeyConditionExpression: 'checkId = :checkId',
      ExpressionAttributeValues: { ':checkId': checkId },
    }),
  );
  return (Items ?? []).reduce((max, ticket) => Math.max(max, ticket.round as number), 0) + 1;
}

async function confirmPaymentOnce(orderId: string, paymentMethod: PaymentMethod) {
  const order = await getOrder(orderId);
  if (!order) throw new OrderRejectedError('ORDER_NOT_FOUND');

  const ticketId = ticketIdForOrder(orderId);
  const status = effectiveOrderStatus(order, Date.now());
  if (status === 'EXPIRED') throw new OrderRejectedError('ORDER_EXPIRED');
  if (status === 'PAID') {
    return { order, ticket: await getItem<KitchenTicket>(TABLES.ticket, { id: ticketId }) };
  }

  const seating = await getItem<{ checkId: string }>(TABLES.seating, { tableId: order.tableId });
  const checkId = seating?.checkId ?? randomUUID();
  const round = seating ? await nextRoundForCheck(checkId) : 1;
  const now = new Date().toISOString();

  const paidOrder: Order = { ...order, status: 'PAID', checkId, paymentMethod, paidAt: now };
  const ticket: KitchenTicket = {
    id: ticketId,
    checkId,
    tableName: order.tableName,
    round,
    status: 'NEW',
    sentAt: now,
    lines: order.lines,
  };
  const check = seating
    ? undefined
    : { id: checkId, tableId: order.tableId, tableName: order.tableName, openedAt: now };

  const openTable = !check
    ? [
        {
          // The table must still be on this check when the transaction commits.
          ConditionCheck: {
            TableName: TABLES.seating,
            Key: { tableId: order.tableId },
            ConditionExpression: 'checkId = :checkId',
            ExpressionAttributeValues: { ':checkId': checkId },
          },
        },
      ]
    : [
        {
          Put: {
            TableName: TABLES.check,
            Item: { ...record('GuestCheck', now), ...check },
          },
        },
        {
          Put: {
            TableName: TABLES.seating,
            Item: { ...record('Seating', now), tableId: order.tableId, checkId },
            ConditionExpression: 'attribute_not_exists(tableId)',
          },
        },
      ];

  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLES.order,
            Key: { id: orderId },
            UpdateExpression:
              'SET #status = :paid, checkId = :checkId, paymentMethod = :method, paidAt = :now, updatedAt = :now',
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':paid': 'PAID',
              ':pending': 'PENDING',
              ':checkId': checkId,
              ':method': paymentMethod,
              ':now': now,
            },
          },
        },
        {
          Put: {
            TableName: TABLES.ticket,
            Item: { ...record('KitchenTicket', now), ...ticket },
            ConditionExpression: 'attribute_not_exists(id)',
          },
        },
        ...openTable,
      ],
    }),
  );
  return { order: paidOrder, ticket, check };
}

async function confirmPayment(orderId: string, paymentMethod: PaymentMethod) {
  // Losing a race, such as two payments opening one table, cancels the
  // transaction. Trying again sees what the winner wrote.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await confirmPaymentOnce(orderId, paymentMethod);
    } catch (error) {
      if (!(error instanceof TransactionCanceledException) || attempt === 3) throw error;
    }
  }
}

async function tableForToken(tableToken: string) {
  const { Items } = await db.send(
    new QueryCommand({
      TableName: TABLES.dining,
      IndexName: 'byQrToken',
      KeyConditionExpression: 'qrToken = :token',
      ExpressionAttributeValues: { ':token': tableToken },
      Limit: 1,
    }),
  );
  return Items?.[0] as { id: string; name: string } | undefined;
}

interface Event {
  fieldName: string;
  arguments: Record<string, never>;
}

export const handler = async ({ fieldName, arguments: args }: Event) => {
  switch (fieldName) {
    case 'placeOrder':
      return createOrder(
        args.orderId,
        await tableForToken(args.tableToken),
        args.items,
        args.expectedTotal,
      );
    case 'placeStaffOrder':
      return createOrder(
        args.orderId,
        await getItem(TABLES.dining, { id: args.tableId }),
        args.items,
        args.expectedTotal,
      );
    case 'confirmOrderPayment':
      return confirmPayment(args.orderId, args.paymentMethod);
    case 'getCustomerTable': {
      const table = await tableForToken(args.tableToken);
      return table ? { name: table.name } : null;
    }
    case 'getCustomerOrder': {
      const order = await getOrder(args.orderId);
      return order ? toCustomerOrder(order) : null;
    }
    default:
      throw new Error(`unknown field ${fieldName}`);
  }
};
