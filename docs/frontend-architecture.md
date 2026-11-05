# 前端架構擴展方向

- **狀態：** 已決定，尚未實作
- **決定日期：** 2026-11-05

## 決定

功能擴展時，**優先導入 TanStack Router 與 TanStack Query**，完成後再開發新領域的功能。

- 保留 `Repository`，作為 Query 的資料來源。
- POS/KDS 的即時狀態繼續由 `useLiveState` 管理，不搬進 Query。

## 何時開始

出現下列任一需求時，就先做本文的導入步驟：

- 要新增 POS、KDS 以外的領域，例如報表、菜單管理、歷史訂單、庫存。
- 要新增需要權限分流的頁面，例如店長專用頁。
- 要新增需要把篩選、分頁條件放進 URL 的頁面。

在此之前不需要導入。目前只有 POS 和 KDS 兩個主畫面，資料也幾乎都是即時狀態，導入的收益不大。

## 背景

目前的做法在兩個主畫面的規模下夠用，但擴展時會遇到這些問題：

| 現況 | 位置 | 擴展時的問題 |
|---|---|---|
| 手寫 hash 路由，用正規表達式解析參數 | `useHashPath`（`src/App.tsx`）、`src/pos/PosPage.tsx` | 參數沒有型別，也沒有巢狀版面、路由守衛和頁面級 code splitting |
| 目錄用 `useState` 加 `reloadCatalog` 載入 | `src/App.tsx` | 每種請求式資料都要重寫載入、失敗和快取邏輯 |
| 所有狀態放在同一個 `AppContext` | `src/appContext.ts` | 任何變動都會重新渲染所有 `useApp()` 的元件 |
| 手動管理寫入狀態 | `useAction`（`src/appContext.ts`） | 每個新動作都要自行串接 `busy`、錯誤提示和本地更新 |

## 各層職責

| 層 | 負責 | 工具 |
|---|---|---|
| 路由 | 目前頁面、URL 參數、頁面載入、權限守衛 | TanStack Router |
| 請求式伺服器狀態 | 快取、載入狀態、重新抓取、mutation 狀態 | TanStack Query |
| 即時伺服器狀態 | 快照加事件同步 | `useLiveState` |
| 資料來源 | 後端合約，以及 Amplify 和 demo 兩種實作 | `Repository` |
| 本地狀態 | 尚未送廚的點餐草稿、toast | React state 或 client store |

頁面和 Query 都只透過 `Repository` 取得資料，不直接呼叫 Amplify SDK。

## 為什麼這樣決定

**為什麼保留 `Repository`：** Query 管的是資料取回後如何快取，不管資料從哪裡來。拿掉 `Repository` 會失去不需要 AWS 的 demo 模式，以及用記憶體 storage 測試業務流程的能力。

**為什麼 `useLiveState` 不搬進 Query：** 它必須暫存載入期間收到的事件，再重播到快照上，否則較新的事件可能被較舊的快照蓋掉（見 `src/data/useLiveState.ts`）。Query 不提供這個機制，搬過去仍要自己寫，還要多處理它和 refetch 的競爭。

**沒有採用的方案：**

- **繼續手寫：** 頁面和請求式資料變多後，等於自己重寫一套較不完整的路由和快取。
- **只導入 Query：** 報表和後台頁面需要的 URL 篩選條件、權限守衛，仍然要手寫。

## 導入步驟

每一步完成後，`npm test` 和 `npm run typecheck` 都應通過，POS/KDS 的行為也應維持不變。

1. **建立基礎設定：** 安裝套件，建立 `QueryClient`，並把 `queryClient` 和 `repository` 放進 Router context。`main.tsx` 選擇實作的方式不變。`Authenticator` 仍然包在 Router 外層。
2. **遷移現有路由：** 用 hash history 保留現有網址，再移除 `useHashPath` 和 `PosPage` 裡的正規表達式。

   | 網址 | 頁面 |
   |---|---|
   | `#/pos` | `FloorView` |
   | `#/pos/table/$tableId` | `TableView` |
   | `#/kds` | `KdsPage` |

3. **遷移目錄資料：** 用 `useQuery` 取代 `catalog`、`catalogState` 和 `reloadCatalog`，並用它驗證本文的做法。
4. **開發新領域：** 新領域一律使用 Query 和 file-based routes，並放在 `src/features/<領域>/`。既有的 `Actions` 不必一次改完，修改到時再逐步換成 `useMutation`。

## 範例

```ts
// src/features/reports/queries.ts
export const salesQuery = (repository: ReportRepository, range: DateRange) =>
  queryOptions({
    queryKey: ['reports', 'sales', range],
    queryFn: () => repository.getSales(range),
  });

// src/routes/reports.sales.tsx
export const Route = createFileRoute('/reports/sales')({
  validateSearch: salesSearchSchema,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      salesQuery(context.repositories.reports, deps.range),
    ),
});
```

`ReportRepository` 和 `repositories` 是拆分後才會有的名稱，見下一節。

## 之後視情況調整

這些不屬於這次決定，等出現對應的狀況再處理：

| 狀況 | 調整 |
|---|---|
| 新領域開始加入，`Repository` 變大 | 按領域拆成小介面，由 `repositories` 物件統一注入 |
| `AppContext` 造成明顯的效能問題 | 把 `useLiveState` 改成外部 store，透過 `useSyncExternalStore` 加 selector 訂閱，`applyEvent` 不用改 |
| 結帳開始涉及折扣、發票或金流 | 把規則和交易移到後端，前端只送出指令 |
| 不再需要 demo 模式，也只有一個後端 | 把 `Repository` 簡化成各領域的 API 函式 |
