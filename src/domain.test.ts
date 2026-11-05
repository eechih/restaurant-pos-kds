import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoRepository } from './data/demoRepository';
import { sampleCatalog } from './data/sampleCatalog';
import {
  applyEvent,
  billTotal,
  buildLine,
  ConflictError,
  emptyLiveState,
  isFullyVoided,
  missingRequiredGroups,
  nextRound,
  tableState,
  toggleChoice,
  unitPriceOf,
  unservedTickets,
  voidId,
  type KitchenTicket,
  type LiveState,
  type MenuItem,
  type TicketLine,
} from './domain';

const item = (id: string): MenuItem => {
  const found = sampleCatalog.items.find((candidate) => candidate.id === id);
  assert.ok(found);
  return found;
};

const line = (id: string, unitPrice: number, quantity = 1): TicketLine => ({
  id,
  menuItemId: 'm',
  name: id,
  quantity,
  unitPrice,
  options: [],
});

const ticket = (id: string, lines: TicketLine[], round = 1): KitchenTicket => ({
  id,
  checkId: 'c1',
  tableName: 'A1',
  round,
  status: 'NEW',
  sentAt: `2026-11-04T10:0${round}:00.000Z`,
  lines,
});

const withVoid = (state: LiveState, ticketId: string, lineId: string): LiveState =>
  applyEvent(state, {
    type: 'void/upsert',
    lineVoid: {
      id: voidId(ticketId, lineId),
      ticketId,
      checkId: 'c1',
      lineId,
      reason: '點錯',
      voidedAt: '2026-11-04T10:05:00.000Z',
    },
  });

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

test('unit price adds every selected option to the base price', () => {
  const noodle = item('item-beef-noodle');
  const selection = { 'noodle-addons': ['addon-egg', 'addon-beef'], spice: ['spice-hot'] };
  assert.equal(unitPriceOf(noodle, selection), 180 + 15 + 60);
});

test('a required group must have a choice', () => {
  const tea = item('item-black-tea');
  assert.deepEqual(
    missingRequiredGroups(tea, { sugar: ['sugar-half'] }).map((group) => group.id),
    ['ice'],
  );
  assert.deepEqual(missingRequiredGroups(tea, { sugar: ['sugar-half'], ice: ['ice-none'] }), []);
});

test('single choice groups replace, multiple choice groups accumulate', () => {
  const noodle = item('item-beef-noodle');
  const [spice, addOns] = noodle.optionGroups;
  let selection = toggleChoice({}, spice, 'spice-mild');
  selection = toggleChoice(selection, spice, 'spice-hot');
  assert.deepEqual(selection.spice, ['spice-hot']);
  selection = toggleChoice(selection, spice, 'spice-hot');
  assert.deepEqual(selection.spice, ['spice-hot'], 'a required choice stays selected');

  selection = toggleChoice(selection, addOns, 'addon-egg');
  selection = toggleChoice(selection, addOns, 'addon-beef');
  assert.deepEqual(selection['noodle-addons'], ['addon-egg', 'addon-beef']);
  selection = toggleChoice(selection, addOns, 'addon-egg');
  assert.deepEqual(selection['noodle-addons'], ['addon-beef']);
});

test('a line keeps its price and options after the menu changes', () => {
  const noodle = structuredClone(item('item-beef-noodle'));
  const built = buildLine('l1', noodle, { spice: ['spice-hot'], 'noodle-addons': ['addon-egg'] }, 2, '  不要蔥 ');
  noodle.price = 999;
  assert.equal(built.unitPrice, 195);
  assert.equal(built.quantity, 2);
  assert.equal(built.note, '不要蔥');
  assert.deepEqual(built.options.map((option) => option.choiceName), ['大辣', '加滷蛋']);
});

test('the bill spans every round and excludes voided lines', () => {
  let state = applyEvent(emptyLiveState, {
    type: 'ticket/upsert',
    ticket: ticket('t1', [line('a', 100, 2), line('b', 50)], 1),
  });
  state = applyEvent(state, { type: 'ticket/upsert', ticket: ticket('t2', [line('c', 30)], 2) });
  assert.equal(billTotal(state, 'c1'), 280);
  assert.equal(nextRound(state, 'c1'), 3);

  state = withVoid(state, 't1', 'b');
  assert.equal(billTotal(state, 'c1'), 230);
});

test('a fully voided ticket needs no service', () => {
  let state = applyEvent(emptyLiveState, {
    type: 'ticket/upsert',
    ticket: ticket('t1', [line('a', 100), line('b', 50)]),
  });
  state = withVoid(state, 't1', 'a');
  assert.equal(isFullyVoided(state, state.tickets.t1), false);
  assert.equal(unservedTickets(state, 'c1').length, 1);

  state = withVoid(state, 't1', 'b');
  assert.equal(isFullyVoided(state, state.tickets.t1), true);
  assert.equal(unservedTickets(state, 'c1').length, 0);
});

test('a table moves from empty to dining to paid and back to empty', async () => {
  const repository = createDemoRepository(memoryStorage());
  const tableId = 'table-A1';
  assert.equal(tableState(await repository.loadLiveState(), tableId), 'EMPTY');

  const check = await repository.openTable({ tableId, tableName: 'A1', guestCount: 2 });
  assert.equal(tableState(await repository.loadLiveState(), tableId), 'DINING');

  await repository.payCheck({ checkId: check.id, paymentMethod: 'CASH', total: 100 });
  const paid = await repository.loadLiveState();
  assert.equal(tableState(paid, tableId), 'PAID');
  assert.equal(paid.checks[check.id].total, 100);

  await repository.clearTable(tableId);
  assert.equal(tableState(await repository.loadLiveState(), tableId), 'EMPTY');
});

test('opening an occupied table is rejected and keeps the first check', async () => {
  const repository = createDemoRepository(memoryStorage());
  const input = { tableId: 'table-A1', tableName: 'A1', guestCount: 2 };
  const first = await repository.openTable(input);
  await assert.rejects(repository.openTable(input), ConflictError);
  assert.equal((await repository.loadLiveState()).seatings['table-A1'].checkId, first.id);
});

test('retrying a send or a void does not duplicate it or reset progress', async () => {
  const repository = createDemoRepository(memoryStorage());
  const sent = ticket('t1', [line('a', 100)]);
  await repository.sendTicket(sent);
  await repository.setTicketStatus('t1', 'PREPARING');
  await repository.sendTicket(sent);

  const lineVoid = {
    id: voidId('t1', 'a'),
    ticketId: 't1',
    checkId: 'c1',
    lineId: 'a',
    reason: '點錯',
    voidedAt: '2026-11-04T10:05:00.000Z',
  };
  await repository.voidLine(lineVoid);
  await repository.voidLine({ ...lineVoid, reason: '重送' });

  const state = await repository.loadLiveState();
  assert.equal(state.tickets.t1.status, 'PREPARING');
  assert.equal(state.voids[lineVoid.id].reason, '點錯');
});
