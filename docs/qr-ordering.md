# 顧客掃碼點餐

- **狀態：** 已決定，分階段實作中（見[階段](#階段)）
- **決定日期：** 2026-11-05

## 決定

顧客掃描桌上的 QR Code 自行點餐，**付款成功後廚房才開始製作**。這取代現有的內用後付流程。

| 問題 | 決定 | 原因 |
|---|---|---|
| 付款方式 | 先做櫃台付款，之後再加線上付款 | 兩者共用同一套訂單狀態；櫃台付款不需要金流帳號，可以先驗證整個流程 |
| 同桌多人 | 每支手機各自下單、各自付款 | 共用購物車需要即時同步。缺點是同桌顧客無法合併結帳 |
| 員工代客點餐 | 同樣先付款才送廚 | 保留後付流程就要長期維護兩套帳務邏輯 |

## 流程

```
掃碼 → 看菜單 → 購物車 → 下單 ──────────→ 付款成功 ──→ KDS 製作
                         │ 伺服器重算金額     │ 同一筆交易建立 KitchenTicket
                         └ Order: PENDING     └ Order: PAID
                                  └ 逾時未付 → EXPIRED，廚房不會看到
```

**核心規則：付款成功後，後端才建立 `KitchenTicket`。** KDS 只看得到已付款的單，所以不需要判斷付款狀態。

## 信任邊界

顧客是不可信任的使用者，他們的裝置傳來的任何資料都可能被竄改。

| 角色 | 可以做的事 |
|---|---|
| 顧客（未登入） | 讀菜單與促銷、呼叫 `placeOrder`、用訂單 ID 查自己的訂單 |
| 員工（已登入） | 確認櫃台收款、操作 KDS、管理桌況 |
| 後端 Lambda | 計價、建立訂單、建立 `KitchenTicket` |

規則如下：

- **`placeOrder` 不接受價格：** 顧客只送品項和選項 ID，金額由 Lambda 依菜單和促銷計算。
- **顧客不能直接存取營運資料：** 不對訪客開放 `KitchenTicket`、`GuestCheck`、`Seating`、`Order` 的讀寫，也不開放列出訂單。
- **QR Code 放隨機 token，不放 `tableId`：** `table-A1` 很容易被猜到。訪客不能讀取 token 欄位，否則可以冒用其他桌。
- **訂單 ID 不可猜測：** 顧客查單靠的是持有訂單 ID。

未付款的單不會進廚房，所以惡意下單最多留下會過期的訂單。

## 資料模型

以下是方向，欄位在第 2 階段定案。

```ts
Order: a.model({
  tableId: a.id().required(),
  checkId: a.id().required(),
  status: a.ref('OrderStatus').required(),  // PENDING | PAID | EXPIRED | REFUNDED
  lines: a.ref('TicketLine').required().array().required(),  // 下單時凍結
  total: a.integer().required(),
  expiresAt: a.datetime().required(),
  paymentMethod: a.ref('PaymentMethod'),
  paidAt: a.datetime(),
})
```

對現有模型的影響：

| 模型或函式 | 變更 |
|---|---|
| `GuestCheck` | 保留，代表「這桌這次用餐」。付款狀態移到 `Order` |
| `tableState` | 現有的 `PAID` 代表整桌結清，不符合一桌多筆付款，要重新定義 |
| `KitchenTicket` | 內容不變，改由後端建立，ID 由 `orderId` 推導 |
| `LineVoid` | 付款後取消品項要連動退款 |
| `MenuItem` | 新增 `available`（售完）和 `featured`（推薦） |
| `DiningTable` | 新增 QR token，訪客不可讀 |

## 關鍵規則

- **付款確認要能重複處理：** 金流通知可能重送。用 `orderId` 推導固定的 ticket ID，再用 DynamoDB 交易同時更新訂單和建立工作單，重送也不會多一張單。
- **金額在下單時凍結：** 購物車顯示的只是預估價。如果和伺服器算的不同，要請顧客確認後才建立訂單。
- **售完由後端檢查：** `placeOrder` 要拒絕 `available` 為 false 的品項。付款後才發現缺貨時走退款流程。
- **顧客查單用輪詢：** 第一版不需要 `useLiveState`，用 TanStack Query 的 `refetchInterval` 即可。

## 前端結構

顧客端和員工端共用一個網站和同一套路由，但彼此隔離：

- **登入：** 員工路由在 `Authenticator` 內；顧客路由（`#/order/$tableToken`）在外，不需要登入。
- **載入：** 員工端的程式碼（Amplify 登入介面、`useLiveState`）按需載入，顧客不會下載。
- **資料存取：** 顧客端用獨立的 `CustomerRepository`，拿不到 `clearTable` 這類員工方法。
- **Demo 模式：** 同樣提供 demo 實作，以本地模擬付款。它無法展示信任邊界，因為所有資料都在瀏覽器裡。

導入方式見[前端架構擴展方向](frontend-architecture.md)。

## 這個設計解決的已知限制

README 列出的兩項限制在顧客下單流程中不再存在：

- **結帳和送廚的競爭：** 每筆訂單各自付款後才送廚。
- **伺服器不驗算金額：** 金額改由伺服器計算。

## 階段

| 階段 | 內容 | 狀態 |
|---|---|---|
| 1. 基礎 | 導入 Router + Query，分開顧客端和員工端入口 | 已完成 |
| 2. 下單與櫃台付款 | `Order`、`placeOrder`、權限、QR token；員工在 POS 確認收款後送廚 | 未開始 |
| 3. 顧客端介面 | 手機版菜單、購物車、訂單狀態 | 未開始 |
| 4. 線上付款 | 串接金流（TapPay、綠界、藍新、LINE Pay 等）、付款通知、退款、電子發票 | 未開始 |
| 5. 商品功能 | 推薦 → 促銷 → 人氣 | 未開始 |

## 商品功能（第 5 階段）

這些功能都顯示在顧客端，資料要開放訪客讀取。

- **推薦：** 人工挑選，用 `MenuItem.featured` 標記，顯示為虛擬分類分頁。
- **促銷：** 第一版只做單品特價，用 `Promotion` 模型記錄固定特價和期間。固定價可以避免百分比折扣的四捨五入問題；多個促銷重疊時取最低價，折扣只作用於基本價，不含加料。價格由 `placeOrder` 計算。`TicketLine` 新增選填的 `listPrice` 和 `promotionName`。寫入權限只開放給店長群組。
- **人氣：** 用排程 Lambda 定期彙總近 30 天的銷量，寫入 `ItemPopularity`。不在前端計算，因為 `loadLiveState` 沒有歷史銷售，`LineVoid` 也沒有時間索引。資料太少時隱藏分頁。
- **暫不做：** 滿額折、第二件半價這類整單優惠，等單品特價穩定後再評估。
