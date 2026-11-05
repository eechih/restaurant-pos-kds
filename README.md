# 餐廳 POS + KDS PoC

內用後付流程的 POS 與廚房顯示系統（KDS），使用 AWS Amplify Gen 2 + React。

**流程：** 開桌 → 點餐送廚 → 廚房出餐 → 加點再送廚 → 結帳 → 清桌

## 本機試用（不需要 AWS）

```bash
npm install
npm run dev
```

打開 http://localhost:5173 ，匯入範例資料。把 `#/pos` 和 `#/kds` 開在兩個分頁，就能看到同步。

沒有 `amplify_outputs.json` 時，App 會進入**本機展示模式**：資料存在瀏覽器裡，只會在同一台裝置、同一個瀏覽器的分頁之間同步，也不需要登入。

## 部署到 AWS

需要已設定好的 AWS 憑證。

```bash
npx ampx sandbox
```

這會建立一套個人開發用的 Cognito、AppSync 和 DynamoDB，並產生 `amplify_outputs.json`。App 偵測到這個檔案就會改用 AWS。

公開註冊已關閉，第一個帳號要由管理員建立。User Pool ID 在 `amplify_outputs.json` 的 `auth.user_pool_id`：

```bash
aws cognito-idp admin-create-user --user-pool-id <USER_POOL_ID> --username <EMAIL>
```

Cognito 會寄送臨時密碼，第一次登入時要變更。

正式部署可將 repo 連接到 Amplify Hosting，會使用 `amplify.yml`。

移除 sandbox 資源：

```bash
npx ampx sandbox delete
```

## 資料模型

| 模型 | 用途 |
|---|---|
| `DiningTable`、`MenuCategory`、`MenuItem` | 桌位與菜單，客製選項內嵌在品項裡 |
| `Seating` | 目前哪一桌有人；以 `tableId` 為主鍵 |
| `GuestCheck` | 一次用餐的帳單 |
| `KitchenTicket` | 一次送廚；品項內容寫入後不再變更 |
| `LineVoid` | 品項取消紀錄；帳單金額不含已取消品項 |

幾個設計決定：

- **防止重複開桌：** 建立 `Seating` 時，伺服器會檢查該桌的紀錄是否已存在，所以兩人同時開桌只有一人成功。
- **同時加點不互相覆蓋：** 每次送廚和每筆取消都是新紀錄，不會去改同一筆資料。
- **重送不會重複：** 送廚和取消的 ID 是固定的，網路失敗後重試不會讓廚房多一張單。
- **品項快照：** 名稱、價格和選項在點餐時就存進工作單，之後改菜單不影響既有帳單。
- **斷線補單：** App 在連線恢復時會重新載入完整資料，另外每 60 秒同步一次，以補上斷線期間錯過的事件。

## 測試

```bash
npm test
npm run typecheck
```

## PoC 的已知限制

正式上線前要處理：

- **金額由前端計算：** 伺服器不會驗算價格和總額，任何登入的員工都能寫入任意金額。
- **結帳和送廚可能同時發生：** A 結帳的同時 B 送廚，這張單可能沒算進已收款金額。正式版應由後端用交易處理。
- **權限：** 所有登入帳號權限相同，沒有店長、外場、廚房之分。
- **時間以裝置時鐘為準：** KDS 的等待時間會受各裝置時鐘誤差影響。
- **取消只能取消整筆品項：** 要從 3 份改成 2 份時，需取消後重新點餐。
- **未儲存的點餐：** 尚未送廚的品項只存在該裝置的記憶體，重新整理就會消失。
- **離線：** 斷線時無法送廚或結帳，畫面會顯示連線狀態。
