import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAction, useApp, useNow } from '../appContext';
import {
  billTotal,
  ConflictError,
  elapsedMinutes,
  formatMoney,
  isFullyVoided,
  tableState,
  ticketsForCheck,
  ticketsWithStatus,
  type DiningTable,
  type KitchenTicket,
} from '../domain';
import { Modal } from '../ui/Modal';

function useGoToTable() {
  const navigate = useNavigate();
  return (tableId: string) => void navigate({ to: '/pos/table/$tableId', params: { tableId } });
}

export function FloorView() {
  const { catalog, live, actions } = useApp();
  const { busy, run } = useAction();
  const [opening, setOpening] = useState<DiningTable>();

  if (catalog.tables.length === 0) {
    return (
      <div className="seed-prompt">
        <h1>還沒有桌位和菜單</h1>
        <p>匯入 8 張桌位和 12 道範例菜色，就可以開始點餐。</p>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => run(actions.seedCatalog, '匯入範例資料失敗')}
        >
          {busy ? '匯入中…' : '匯入範例資料'}
        </button>
      </div>
    );
  }

  const ready = ticketsWithStatus(live.state, ['READY']).filter(
    (ticket) => !isFullyVoided(live.state, ticket),
  );

  return (
    <div className="floor">
      <section aria-label="桌位">
        <h1 className="section-title">桌位</h1>
        <div className="table-grid">
          {catalog.tables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              onOpen={() => setOpening(table)}
            />
          ))}
        </div>
      </section>
      <aside className="ready-panel" aria-label="待上菜">
        <h2 className="section-title">待上菜 {ready.length > 0 && <span className="count">{ready.length}</span>}</h2>
        {ready.length === 0 ? (
          <p className="empty-note">廚房完成後會顯示在這裡</p>
        ) : (
          ready.map((ticket) => <ReadyTicket key={ticket.id} ticket={ticket} />)
        )}
      </aside>
      {opening && <GuestCountDialog table={opening} onClose={() => setOpening(undefined)} />}
    </div>
  );
}

function TableCard({ table, onOpen }: { table: DiningTable; onOpen(): void }) {
  const { live } = useApp();
  const goToTable = useGoToTable();
  const now = useNow();
  const status = tableState(live.state, table.id);
  const check = live.state.checks[live.state.seatings[table.id]?.checkId];

  if (status === 'EMPTY' || !check) {
    return (
      <button className="table-card table-empty" onClick={status === 'EMPTY' ? onOpen : () => goToTable(table.id)}>
        <span className="table-name">{table.name}</span>
        <span className="table-meta">{status === 'EMPTY' ? `空桌・${table.seats} 人座` : '載入中…'}</span>
      </button>
    );
  }

  const readyCount = ticketsForCheck(live.state, check.id).filter(
    (ticket) => ticket.status === 'READY' && !isFullyVoided(live.state, ticket),
  ).length;

  return (
    <button
      className={status === 'PAID' ? 'table-card table-paid' : 'table-card table-dining'}
      onClick={() => goToTable(table.id)}
    >
      <span className="table-name">{table.name}</span>
      {status === 'PAID' ? (
        <span className="table-meta">已結帳・待清桌</span>
      ) : (
        <>
          <span className="table-meta">
            {check.guestCount} 人・{elapsedMinutes(check.openedAt, now)} 分鐘
          </span>
          <span className="table-amount">{formatMoney(billTotal(live.state, check.id))}</span>
          {readyCount > 0 && <span className="table-alert">{readyCount} 張待上菜</span>}
        </>
      )}
    </button>
  );
}

function ReadyTicket({ ticket }: { ticket: KitchenTicket }) {
  const { actions } = useApp();
  const { busy, run } = useAction();
  return (
    <div className="ready-row">
      <div>
        <strong>{ticket.tableName}</strong> 第 {ticket.round} 輪
        <div className="line-options">
          {ticket.lines.map((line) => `${line.name}×${line.quantity}`).join('、')}
        </div>
      </div>
      <button
        className="button button-primary button-small"
        disabled={busy}
        onClick={() => run(() => actions.setTicketStatus(ticket, 'SERVED'), '更新上菜狀態失敗')}
      >
        已上菜
      </button>
    </div>
  );
}

function GuestCountDialog({ table, onClose }: { table: DiningTable; onClose(): void }) {
  const { actions, notify } = useApp();
  const goToTable = useGoToTable();
  const { busy, run } = useAction();
  const [guestCount, setGuestCount] = useState(table.seats);

  const open = () =>
    run(async () => {
      try {
        await actions.openTable({ tableId: table.id, tableName: table.name, guestCount });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        notify(`${table.name} 剛被其他人開桌`, true);
      }
      onClose();
      goToTable(table.id);
    }, '開桌失敗');

  return (
    <Modal
      title={`${table.name} 開桌`}
      onClose={onClose}
      footer={
        <button className="button button-primary button-wide" disabled={busy} onClick={open}>
          開桌（{guestCount} 人）
        </button>
      }
    >
      <p className="field-label" id="guest-count-label">用餐人數</p>
      <div className="chip-row" role="radiogroup" aria-labelledby="guest-count-label">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
          <button
            key={count}
            role="radio"
            aria-checked={guestCount === count}
            className={guestCount === count ? 'chip is-selected' : 'chip'}
            onClick={() => setGuestCount(count)}
          >
            {count}
          </button>
        ))}
      </div>
    </Modal>
  );
}
