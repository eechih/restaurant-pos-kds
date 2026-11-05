import { useApp } from '../appContext';
import { FloorView } from './FloorView';
import { TableView } from './TableView';

export function PosPage({ path }: { path: string }) {
  const { catalogState } = useApp();
  if (catalogState === 'loading') return <p className="empty-note">載入中…</p>;
  if (catalogState === 'failed') return <p className="empty-note">無法載入菜單，請重新整理頁面</p>;

  const tableId = path.match(/^\/pos\/table\/(.+)$/)?.[1];
  return tableId ? <TableView key={tableId} tableId={decodeURIComponent(tableId)} /> : <FloorView />;
}
