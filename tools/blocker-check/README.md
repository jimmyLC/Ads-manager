# blocker-check：廣告攔截自我檢查

廣告攔截外掛（AdBlock、uBlock、AdGuard）靠公開黑名單判斷什麼是廣告。
本工具抓四份真實黑名單，比對兩個站公開面上的 **class 名稱** 與 **URL**，任何規則命中就 FAIL。
用來確認第一方版位不會被攔截（SPEC §2.3 紅線 2「中性命名」）。

```bash
npm run blocker-check            # javis 與 javid 都檢查
npm run blocker-check -- javid   # 只檢查單一站
```

需要連網（讀取清單到記憶體比對，**不存檔**）。命中時列出規則並以非 0 結束。

## 比對的清單

| 名稱 | 來源 |
|---|---|
| EasyList | https://easylist.to/easylist/easylist.txt |
| EasyList 通用隱藏 | https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt |
| AdGuard Base | https://filters.adtidy.org/extension/ublock/filters/2.txt |
| AdGuard 中文 | https://filters.adtidy.org/extension/ublock/filters/224.txt |

清單本身不放進 repo（體積大、持續更新、有各自的授權），要重現就重跑指令。

## 比對的名稱與網址

設定在 `check.mts` 的 `SITES`。**改版位命名或路徑時要同步更新這裡。**

| 站 | class／id | URL（id、token 為示意值） |
|---|---|---|
| javis | `spotlight-slot`、`spotlight-slot-html` | `/api/spotlight/img/as_…/{desktop,mobile,…@2x}?t=…`、`/api/spotlight/out/cr_…?placement=…` |
| javid | `promo-slot`、`filled` | `/api/promo/serve?slot=…`、`/api/promo/img/as_…?d=…&t=…`、`/api/promo/out/cr_…?d=…&placement=…` |

## 紀錄

| 日期 | 站 | 結果 |
|---|---|---|
| 2026-11-03 | javis、javid | EasyList 77,541／EasyList 通用隱藏 13,685／AdGuard Base 148,105／AdGuard 中文 21,644 條規則，**全部 0 命中** |

## 限制

- 只比對這四份清單**當下版本**；清單更新後需重跑。
- 簡化版比對：不處理 regex 型規則（保守跳過）、只看圖片與文件請求、把我們視為第一方。
- 沒有在真實瀏覽器裡裝外掛實測。上線後建議各用一個常見外掛手動看一次。
- 來源：改寫自 vod-site 的 `scripts/blocker-check.ts`（單站版），此處增加多站設定。
