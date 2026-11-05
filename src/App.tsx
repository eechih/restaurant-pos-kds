import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Repository } from './data/repository';
import { useLiveState } from './data/useLiveState';
import { emptyCatalog, type Actions, AppContext, type Draft } from './appContext';
import type { Catalog } from './domain';
import { KdsPage } from './kds/KdsPage';
import { PosPage } from './pos/PosPage';

function useHashPath() {
  const read = () => window.location.hash.replace(/^#/, '') || '/pos';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

interface AppProps {
  repository: Repository;
  userLabel?: string;
  onSignOut?: () => void;
}

export function App({ repository, userLabel, onSignOut }: AppProps) {
  const path = useHashPath();
  const live = useLiveState(repository);
  const { dispatch } = live;
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<{ id: number; message: string; isError: boolean }>();

  const reloadCatalog = useCallback(async () => {
    try {
      setCatalog(await repository.getCatalog());
      setCatalogState('ready');
    } catch (error) {
      console.error('Failed to load catalog', error);
      setCatalogState('failed');
    }
  }, [repository]);

  useEffect(() => void reloadCatalog(), [reloadCatalog]);

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
        await reloadCatalog();
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
    [repository, reloadCatalog, dispatch],
  );

  const context = useMemo(
    () => ({ catalog, catalogState, live, actions, drafts, setDraft, notify }),
    [catalog, catalogState, live, actions, drafts, setDraft, notify],
  );

  const isKds = path.startsWith('/kds');

  return (
    <AppContext.Provider value={context}>
      <div className={isKds ? 'app theme-kds' : 'app'}>
        <header className="topbar">
          <nav className="topbar-nav" aria-label="主要頁面">
            <a href="#/pos" className={isKds ? '' : 'is-active'}>POS</a>
            <a href="#/kds" className={isKds ? 'is-active' : ''}>KDS 廚房</a>
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
        <main className="page">{isKds ? <KdsPage /> : <PosPage path={path} />}</main>
        {toast && (
          <div key={toast.id} className={toast.isError ? 'toast toast-error' : 'toast'} role="alert">
            {toast.message}
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
