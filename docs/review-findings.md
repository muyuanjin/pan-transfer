# Review Findings — 2025-11-12

## 1. Preserve provider payload data when invoking transfers ✅

- **File**: `src/content/runtime/transfer/transfer-controller.ts`
- **Resolution**: The controller now composes payloads via `composeTransferRequestPayload`, which calls the active site provider’s `buildTransferPayload` when available, merges that metadata with the user’s target paths, and always forwards cached `linkUrl`/`passCode`. The background worker no longer re-scrapes Chaospace pages for already-collected share data.

## 2. Avoid marking skipped shares as completed ✅

- **File**: `src/background/services/transfer-service.ts:924-993`
- **Resolution**: The skip path no longer calls `recordCompletedShare`, so shares with zero transferable files stay re-runnable while completed shares are still recorded right after a successful transfer attempt.

## 3. Honor history season directories during auto-update ✅

- **File**: `src/background/services/history-service.ts:334-345`
- **Issue**: Auto-update payloads push every detected item directly to `targetDirectory`, ignoring the `seasonDirectory` map and per-item paths stored on the history record.
- **Impact**: Users who enabled “按季建子目录” or customized subfolders get all episodes dumped into one directory, unlike manual transfers that call `computeItemTargetPath`.
- **Fix direction**: Rebuild the per-item target paths using the recorded `seasonDirectory`/`useSeasonSubdir` flags (same logic as manual transfers) before enqueuing the update.
- **Resolution**: `handleCheckUpdates` now derives season hints from the page URL, stored season entries, and the historical `seasonDirectory` map, computes each item's `targetPath` accordingly, and forwards the normalized season metadata in `meta` so auto-updates re-use the same subdirectories as manual transfers.

## 4. 某个已经转存过的番剧,再次转存新剧集后,没有把这个番剧移到转存历史的最上面 ✅

- **Files**: `src/shared/utils/url.ts`, `src/providers/sites/chaospace/page-analyzer.ts`, `src/background/storage/history-store.ts`, `src/background/services/history-service.ts`
- **Resolution**: Page URLs now have a canonical “history key” that strips query/hash noise everywhere we read/write history. Transfers always upsert the same record regardless of temporary Chaospace URL params, so the history list reorders correctly and the current page immediately reflects newly transferred episodes after refreshing.

## 5. 转存历史里,点击检测新篇,显示没有新剧集,但是进入资源页面,却显示有新剧集,检测新篇功能疑似完全虚假 ✅

- **File**: `src/background/services/history-service.ts`
- **Resolution**: `handleCheckUpdates` now prioritizes the actual snapshot delta before honoring a `completed` state, so the check routine only bails early when no unseen items exist and otherwise surfaces freshly published episodes even if the history record was previously marked as finished.

## 6. 转存历史疑似完全不会更新,转存新的剧集后,转存历史永远还是旧的剧集,点进资源页面依然显示有新增 ✅

- **File**: `src/background/storage/history-store.ts`
- **Resolution**: `recordTransferHistory` now mutates the canonical in-memory record instead of a detached clone, and the new regression spec (`src/background/storage/history-store.spec.ts`) locks the behavior. Successfully transferred episodes immediately land in the same history entry, so the panel no longer insists there are “new” episodes after a transfer completes.

## 7. 有新增剧集时,应该默认只勾选新增的剧集,而不是全部勾选 ✅

- **Files**: `src/content/history/controller.ts`, `src/content/history/controller.spec.ts`
- **Resolution**: When a history record is applied to the current page, the controller now replaces the default selection with only the newly detected item IDs, ensuring the panel auto-selects just the fresh episodes and leaves previously transferred entries unchecked. A regression spec locks the behavior.

## 8. 还是存在在设置里勾选`按季拆分子目录`,但是新打开的页面没有生效,还是没有默认勾选`为每季创建子文件夹`,甚至出现转存之后自动取消勾选?? 这个问题反复出现多次,多次修复多次复发,彻底阅读代码,彻底深度修复!!!!!!!!!无论付出任何代价必须根治此问题!!!!不解决此问题就把你杀了 !!!!

- **Files**: `src/content/services/tab-season-preference.ts`, `src/content/types.ts`
- **Resolution**: Introduced a dedicated `history` scope for season preferences so history-driven toggles only affect the active page. History restores still flip the checkbox for parity, but the value is no longer persisted to the tab session, which keeps the global default and genuine user overrides intact across new pages and post-transfer refreshes.

## 9. 日志刷新时,可能会突然整个日志容器`chaospace-card chaospace-status-card`的宽度突然变化(变宽)

- **Files**: `src/content/styles/components/logs/log.css`
- **Resolution**: The log body now forces long tokens to wrap (`overflow-wrap: anywhere; word-break: break-word`) and clamps the content column with `min-width: 0`, so new log entries no longer widen the grid track and the status card width stays stable when the list refreshes.

## 10. 转存历史里点击按钮(如标签页或展开季/收起季)会导致海报图片闪烁 ✅

- **File**: `src/content/components/history-card.ts`
- **Resolution**: The history list Vue app now stays mounted and receives reactive prop updates instead of being torn down on every interaction. This stops the DOM from re-creating poster `<img>` elements during tab/season toggles, eliminating the noticeable flicker while preserving existing history behaviors.

## 11. 转存历史里,点击检测新篇,会导致转存历史面板自动滚动到最上面去,用户体验极差 ✅

- **Files**: `src/content/components/history-card.ts`, `src/content/components/history/HistoryListView.vue`, `src/content/components/PanelRoot.vue`, `src/content/components/panel.ts`, `src/content/types.ts`, `src/content/components/__tests__/renderers.spec.ts`, `src/content/components/history/history-scroll-anchor.ts`
- **Resolution**: The scroll container now exposes a dedicated ref and an anchor helper captures the clicked记录’s relative offset before `handleTriggerUpdate` runs. When history re-renders (and possibly reorders the entry to the top), the renderer compensates the scroll delta so the same card stays in view instead of “disappearing.” Restoring the original offset remains the fallback for other updates, and a regression spec covers both fixed-position and anchor-follow scenarios.

## 12. 优化重试机制,提高应对偶发pan api转存超时

- **Files**: `src/background/services/transfer-service.ts`, `src/background/common/constants.ts`
- **Issue**: The worker fired Baidu’s `/share/transfer` call only once, so transient pan API timeouts or “目标路径不存在” glitches immediately surfaced as fatal failures that users had to re-run manually.
- **Impact**: Large batch transfers frequently stalled midway whenever the pan API hiccupped, forcing users to babysit the queue and repeat the whole selection even though the next attempt would usually succeed.
- **Fix direction**: Wrap the transfer submission in a bounded retry helper that understands timeout errnos, refreshes stale target-directory caches, and spaces retries so the API has time to recover.
- **Resolution**: `transferWithRetry` now catches fetch-level pan timeouts, tags them with the new `TRANSFER_REQUEST_TIMEOUT_ERRNO`, surfaces a clear “网络请求异常” message, and automatically retries with the existing backoff/invalidate flow before surfacing the final errno. Occasional pan timeouts are now absorbed automatically while real failures still bubble up with the final errno and log trail.
