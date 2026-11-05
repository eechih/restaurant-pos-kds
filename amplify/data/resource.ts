import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

const schema = a
  .schema({
    TicketStatus: a.enum(['NEW', 'PREPARING', 'READY', 'SERVED']),
    CheckStatus: a.enum(['OPEN', 'PAID']),
    PaymentMethod: a.enum(['CASH', 'CARD']),

    OptionChoice: a.customType({
      id: a.id().required(),
      name: a.string().required(),
      priceDelta: a.integer().required(),
    }),
    OptionGroup: a.customType({
      id: a.id().required(),
      name: a.string().required(),
      required: a.boolean().required(),
      multiple: a.boolean().required(),
      choices: a.ref('OptionChoice').required().array().required(),
    }),
    SelectedOption: a.customType({
      groupName: a.string().required(),
      choiceName: a.string().required(),
      priceDelta: a.integer().required(),
    }),
    TicketLine: a.customType({
      id: a.id().required(),
      menuItemId: a.id().required(),
      name: a.string().required(),
      quantity: a.integer().required(),
      unitPrice: a.integer().required(),
      options: a.ref('SelectedOption').required().array().required(),
      note: a.string(),
    }),

    DiningTable: a.model({
      name: a.string().required(),
      seats: a.integer().required(),
      sortOrder: a.integer().required(),
    }),
    MenuCategory: a.model({
      name: a.string().required(),
      sortOrder: a.integer().required(),
    }),
    MenuItem: a.model({
      categoryId: a.id().required(),
      name: a.string().required(),
      price: a.integer().required(),
      sortOrder: a.integer().required(),
      optionGroups: a.ref('OptionGroup').required().array().required(),
    }),

    // Keyed by table so that creating a second seating for an occupied table
    // fails on the server. This is what stops two staff opening the same table.
    Seating: a
      .model({
        tableId: a.id().required(),
        checkId: a.id().required(),
      })
      .identifier(['tableId']),

    GuestCheck: a.model({
      tableId: a.id().required(),
      tableName: a.string().required(),
      guestCount: a.integer().required(),
      status: a.ref('CheckStatus').required(),
      openedAt: a.datetime().required(),
      paidAt: a.datetime(),
      paymentMethod: a.ref('PaymentMethod'),
      total: a.integer(),
    }),

    // Lines are written once. Each send to the kitchen is a separate record, so
    // staff adding to the same table at the same time cannot overwrite each other.
    KitchenTicket: a
      .model({
        checkId: a.id().required(),
        tableName: a.string().required(),
        round: a.integer().required(),
        status: a.ref('TicketStatus').required(),
        sentAt: a.datetime().required(),
        lines: a.ref('TicketLine').required().array().required(),
      })
      .secondaryIndexes((index) => [
        index('status').sortKeys(['sentAt']).queryField('ticketsByStatus'),
        index('checkId').queryField('ticketsByCheck'),
      ]),

    // A void is its own record rather than an edit to the ticket's lines, so
    // concurrent voids on one ticket cannot overwrite each other.
    // id is `${ticketId}#${lineId}`, which makes voiding a line idempotent.
    LineVoid: a
      .model({
        ticketId: a.id().required(),
        checkId: a.id().required(),
        lineId: a.id().required(),
        reason: a.string().required(),
        voidedAt: a.datetime().required(),
      })
      .secondaryIndexes((index) => [index('checkId').queryField('voidsByCheck')]),
  })
  .authorization((allow) => [allow.authenticated()]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
