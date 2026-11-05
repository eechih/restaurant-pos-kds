import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { catalogQuery } from './data/catalogQuery';
import type { Repository } from './data/repository';
import { useLiveState } from './data/useLiveState';
import { emptyCatalog, type Actions, AppContext, type AppContextValue, type Draft } from './appContext';

interface AppProps {
  repository: Repository;
  userLabel?: string;
  onSignOut?: () => void;
}

export function App({ repository, userLabel, onSignOut }: AppProps) {
  const isKds = useLocation({ select: (location) => location.pathname.startsWith('/kds') });
  const queryClient = useQueryClient();
  const live = useLiveState(repository);
  const { dispatch } = live;
  const { data, isPending } = useQuery(catalogQuery(repository));
  const catalog = data ?? emptyCatalog;
  // A failed background refresh keeps showing the menu it already has.
  const catalogState: AppContextValue['catalogState'] = data ? 'ready' : isPending ? 'loading' : 'failed';
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<{ id: number; message: string; isError: boolean }>();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string, isError = false) => {
    setToast({ id: Date.now(), message, isError });
  }, []);

  const setDraft = useCallback((checkId: string, draft: Draft | undefined) => {
    setDrafts((current) => {
      const next = { ...current };
      if (draft) next[checkId] = draft;
      else delete next[checkId];
      return next;
    });
  }, []);

  // Each write is also applied locally: subscription events can lag, and the
  // screen should not show a table as empty straight after it has been opened.
  const actions = useMemo<Actions>(
    () => ({
      async seedCatalog() {
        await repository.seedCatalog();
        await queryClient.invalidateQueries({ queryKey: catalogQuery(repository).queryKey });
      },
      async openTable(input) {
        const check = await repository.openTable(input);
        dispatch({ type: 'check/upsert', check });
        dispatch({ type: 'seating/upsert', seating: { tableId: input.tableId, checkId: check.id } });
        return check;
      },
      async sendTicket(ticket) {
        await repository.sendTicket(ticket);
        dispatch({ type: 'ticket/upsert', ticket });
      },
      async setTicketStatus(ticket, status) {
        await repository.setTicketStatus(ticket.id, status);
        dispatch({ type: 'ticket/upsert', ticket: { ...ticket, status } });
      },
      async voidLine(lineVoid) {
        await repository.voidLine(lineVoid);
        dispatch({ type: 'void/upsert', lineVoid });
      },
      async payCheck(check, paymentMethod, total) {
        await repository.payCheck({ checkId: check.id, paymentMethod, total });
        dispatch({
          type: 'check/upsert',
          check: { ...check, status: 'PAID', paymentMethod, total, paidAt: new Date().toISOString() },
        });
      },
      async clearTable(tableId) {
        await repository.clearTable(tableId);
        dispatch({ type: 'seating/delete', tableId });
      },
    }),
    [repository, queryClient, dispatch],
  );

  const context = useMemo(
    () => ({ catalog, catalogState, live, actions, drafts, setDraft, notify }),
    [catalog, catalogState, live, actions, drafts, setDraft, notify],
  );

  return (
    <AppContext.Provider value={context}>
      <div className={isKds ? 'app theme-kds' : 'app'}>
        <header className="topbar">
          <nav className="topbar-nav" aria-label="主要頁面">
            <Link to="/pos" className={isKds ? '' : 'is-active'}>POS</Link>
            <Link to="/kds" className={isKds ? 'is-active' : ''}>KDS 廚房</Link>
          </nav>
          <div className="topbar-status">
            {repository.mode === 'demo' && (
              <>
                <span className="badge badge-warn">本機展示模式</span>
                <button
                  className="link-button"
                  onClick={() => {
                    repository.resetDemo?.();
                    window.location.hash = '#/pos';
                    window.location.reload();
                  }}
                >
                  重置資料
                </button>
              </>
            )}
            <span className={live.online && !live.syncError ? 'badge badge-ok' : 'badge badge-danger'} role="status">
              {!live.online ? '連線中斷，正在重連' : live.syncError ? '同步失敗，將自動重試' : '已連線'}
            </span>
            {userLabel && <span className="topbar-user">{userLabel}</span>}
            {onSignOut && <button className="link-button" onClick={onSignOut}>登出</button>}
          </div>
        </header>
        <main className="page"><Outlet /></main>
        {toast && (
          <div key={toast.id} className={toast.isError ? 'toast toast-error' : 'toast'} role="alert">
            {toast.message}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
