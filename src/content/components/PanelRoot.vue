<template>
  <div :class="panelClasses">
    <div class="chaospace-float-header">
      <div class="chaospace-header-art is-empty" data-role="header-art"></div>
      <div class="chaospace-header-actions">
        <button
          type="button"
          class="chaospace-theme-toggle"
          data-role="theme-toggle"
          aria-label="切换主题"
          title="切换主题"
        >
          ☀️
        </button>
        <button
          type="button"
          class="chaospace-settings-toggle"
          data-role="settings-toggle"
          aria-label="打开设置"
          title="插件设置"
          aria-expanded="false"
        >
          ⚙️
        </button>
        <button
          type="button"
          class="chaospace-float-pin"
          data-role="pin-toggle"
          title="固定面板"
          aria-pressed="false"
        >
          📌
        </button>
      </div>
      <div class="chaospace-header-content">
        <img
          class="chaospace-header-poster"
          data-role="header-poster"
          alt=""
          loading="lazy"
          decoding="async"
          draggable="false"
          style="display: none"
        />
        <div class="chaospace-header-body">
          <div class="chaospace-header-topline">
            <span class="chaospace-assistant-badge">🚀 CHAOSPACE 转存助手</span>
          </div>
          <h2 class="chaospace-show-title" data-role="show-title">{{ safeTitle }}</h2>
          <p class="chaospace-show-subtitle" data-role="show-subtitle">{{ subtitle }}</p>
        </div>
      </div>
    </div>
    <div class="chaospace-float-body">
      <div class="chaospace-history-overlay" data-role="history-overlay" aria-hidden="true">
        <div class="chaospace-history-overlay-header">
          <div class="chaospace-history-overlay-title">🔖 转存历史</div>
          <button
            type="button"
            class="chaospace-history-toggle"
            data-role="history-toggle"
            aria-expanded="false"
            aria-label="收起转存历史"
          >
            收起
          </button>
        </div>
        <div class="chaospace-history-controls" data-role="history-controls">
          <div class="chaospace-history-tabs" data-role="history-tabs">
            <button type="button" class="chaospace-history-tab is-active" data-filter="all">
              全部
            </button>
            <button type="button" class="chaospace-history-tab" data-filter="series">剧集</button>
            <button type="button" class="chaospace-history-tab" data-filter="ongoing">
              未完结
            </button>
            <button type="button" class="chaospace-history-tab" data-filter="completed">
              已完结
            </button>
            <button type="button" class="chaospace-history-tab" data-filter="movie">电影</button>
          </div>
          <div class="chaospace-history-search">
            <span class="chaospace-history-search-icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              class="chaospace-history-search-input"
              data-role="history-search"
              placeholder="搜索标题、目录或来源"
              aria-label="搜索转存历史"
              enterkeyhint="search"
            />
            <button
              type="button"
              class="chaospace-history-search-clear"
              data-role="history-search-clear"
              aria-label="清除搜索"
              hidden
            >
              ✕
            </button>
          </div>
          <div class="chaospace-history-toolbar" data-role="history-toolbar">
            <label class="chaospace-history-select-all">
              <input type="checkbox" data-role="history-select-all" />
              <span>全选当前筛选结果</span>
            </label>
            <div class="chaospace-history-toolbar-actions">
              <span class="chaospace-history-selection-count" data-role="history-selection-count"
                >已选 0 项</span
              >
              <button
                type="button"
                class="chaospace-history-primary-btn"
                data-role="history-batch-check"
                disabled
              >
                批量检测更新
              </button>
              <button
                type="button"
                class="chaospace-history-ghost-btn"
                data-role="history-delete-selected"
                disabled
              >
                删除选中
              </button>
              <button type="button" class="chaospace-history-ghost-btn" data-role="history-clear">
                清空历史
              </button>
            </div>
          </div>
        </div>
        <div class="chaospace-history-overlay-scroll">
          <div class="chaospace-history-empty" data-role="history-empty">还没有转存记录</div>
          <div class="chaospace-history-list" data-role="history-list"></div>
        </div>
      </div>
      <div class="chaospace-settings-overlay" data-role="settings-overlay" aria-hidden="true">
        <div
          class="chaospace-settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chaospace-settings-title"
        >
          <div class="chaospace-settings-header">
            <div id="chaospace-settings-title" class="chaospace-settings-title">⚙️ 插件设置</div>
            <button
              type="button"
              class="chaospace-settings-close"
              data-role="settings-close"
              aria-label="关闭设置"
            >
              ✕
            </button>
          </div>
          <div class="chaospace-settings-body">
            <form
              id="chaospace-settings-form"
              class="chaospace-settings-form"
              data-role="settings-form"
            >
              <section class="chaospace-settings-section">
                <h3>目录策略</h3>
                <div class="chaospace-settings-field">
                  <label class="chaospace-settings-label" for="chaospace-settings-base-dir"
                    >基础转存目录</label
                  >
                  <input
                    id="chaospace-settings-base-dir"
                    type="text"
                    placeholder="/视频/番剧"
                    data-role="settings-base-dir"
                  />
                  <p class="chaospace-settings-hint">
                    字符串 · 以 / 开头，作为所有转存记录的根目录。
                  </p>
                </div>
                <div class="chaospace-settings-field">
                  <label class="chaospace-settings-checkbox" for="chaospace-settings-use-title">
                    <input
                      id="chaospace-settings-use-title"
                      type="checkbox"
                      data-role="settings-use-title"
                    />
                    <div>
                      <span>按剧名创建子目录</span>
                      <p class="chaospace-settings-hint">
                        布尔值 · 勾选后使用当前页面标题作为子文件夹名称。
                      </p>
                    </div>
                  </label>
                  <label class="chaospace-settings-checkbox" for="chaospace-settings-use-season">
                    <input
                      id="chaospace-settings-use-season"
                      type="checkbox"
                      data-role="settings-use-season"
                    />
                    <div>
                      <span>按季拆分子目录</span>
                      <p class="chaospace-settings-hint">布尔值 · 勾选后为每季单独创建文件夹。</p>
                    </div>
                  </label>
                </div>
                <div class="chaospace-settings-field">
                  <label class="chaospace-settings-label" for="chaospace-settings-presets"
                    >收藏路径列表</label
                  >
                  <textarea
                    id="chaospace-settings-presets"
                    rows="4"
                    data-role="settings-presets"
                    placeholder="/视频/番剧&#10;/视频/影视"
                  ></textarea>
                  <p class="chaospace-settings-hint">
                    字符串数组 · 每行一个路径，保存后自动去重并保留默认示例。
                  </p>
                </div>
              </section>
              <section class="chaospace-settings-section">
                <h3>体验与限速</h3>
                <div class="chaospace-settings-field">
                  <div class="chaospace-settings-label">界面主题</div>
                  <div
                    class="chaospace-segmented chaospace-segmented--settings"
                    data-role="settings-theme"
                    role="radiogroup"
                    aria-label="界面主题"
                  >
                    <button
                      type="button"
                      class="chaospace-segmented-option"
                      data-value="dark"
                      role="radio"
                      aria-checked="false"
                    >
                      深色
                    </button>
                    <button
                      type="button"
                      class="chaospace-segmented-option"
                      data-value="light"
                      role="radio"
                      aria-checked="false"
                    >
                      浅色
                    </button>
                  </div>
                  <p class="chaospace-settings-hint">枚举值 · 影响浮动面板的背景与文字样式。</p>
                </div>
                <div class="chaospace-settings-field">
                  <label class="chaospace-settings-label" for="chaospace-settings-history-rate"
                    >批量检测间隔（秒）</label
                  >
                  <input
                    id="chaospace-settings-history-rate"
                    type="number"
                    min="0.5"
                    max="60"
                    step="0.5"
                    data-role="settings-history-rate"
                  />
                  <p class="chaospace-settings-hint">
                    数字 · 控制批量刷新历史时的最小延迟，避免触发风控（0.5～60 秒）。
                  </p>
                </div>
              </section>
              <section class="chaospace-settings-section">
                <h3>文件过滤</h3>
                <div class="chaospace-settings-field">
                  <label class="chaospace-settings-label" for="chaospace-settings-filter-mode"
                    >命中优先级</label
                  >
                  <select id="chaospace-settings-filter-mode" data-role="settings-filter-mode">
                    <option value="deny-first">否决优先（命中剔除规则即跳过）</option>
                    <option value="allow-first">接受优先（命中保留规则即保留）</option>
                    <option value="ordered">按顺序优先（首个命中规则生效）</option>
                  </select>
                  <p class="chaospace-settings-hint">枚举值 · 控制多个规则同时命中时的决策顺序。</p>
                </div>
                <div class="chaospace-settings-field">
                  <div class="chaospace-settings-label">过滤规则</div>
                  <div
                    class="chaospace-rule-editor"
                    data-role="settings-filter-editor"
                    aria-live="polite"
                  ></div>
                  <p class="chaospace-settings-hint">
                    逐条定义筛选条件，支持按名称、正则、大小、扩展名、类别或目录状态过滤。命中优先级结合下方规则顺序共同决定最终结果。
                  </p>
                </div>
              </section>
              <section class="chaospace-settings-section">
                <h3>文件重命名</h3>
                <div class="chaospace-settings-field">
                  <div class="chaospace-settings-label">重命名规则</div>
                  <div
                    class="chaospace-rule-editor"
                    data-role="settings-rename-editor"
                    aria-live="polite"
                  ></div>
                  <p class="chaospace-settings-hint">
                    依次对文件名（不含扩展名）执行正则替换，可配置描述、开关、正则表达式与替换结果，支持自定义
                    flags。
                  </p>
                </div>
              </section>
              <section class="chaospace-settings-section">
                <h3>导入导出</h3>
                <div class="chaospace-settings-row">
                  <div>
                    <div class="chaospace-settings-row-title">导出设置</div>
                    <p class="chaospace-settings-hint">生成 JSON，包含所有可保存的参数。</p>
                  </div>
                  <button type="button" data-role="settings-export-config">导出</button>
                </div>
                <div class="chaospace-settings-row">
                  <div>
                    <div class="chaospace-settings-row-title">导出全部数据</div>
                    <p class="chaospace-settings-hint">包含设置、转存历史、缓存与面板布局。</p>
                  </div>
                  <button type="button" data-role="settings-export-data">导出</button>
                </div>
                <div class="chaospace-settings-row">
                  <div>
                    <div class="chaospace-settings-row-title">导入设置</div>
                    <p class="chaospace-settings-hint">
                      选择先前导出的设置 JSON，立即覆盖当前参数。
                    </p>
                  </div>
                  <button type="button" data-role="settings-import-config-trigger">导入</button>
                </div>
                <div class="chaospace-settings-row">
                  <div>
                    <div class="chaospace-settings-row-title">导入全部数据</div>
                    <p class="chaospace-settings-hint">
                      覆盖设置、历史、缓存与布局，用于完整迁移。
                    </p>
                  </div>
                  <button type="button" data-role="settings-import-data-trigger">导入</button>
                </div>
                <div class="chaospace-settings-row">
                  <div>
                    <div class="chaospace-settings-row-title">重置面板布局</div>
                    <p class="chaospace-settings-hint">清理已保存的大小与位置，恢复默认摆放。</p>
                  </div>
                  <button type="button" data-role="settings-reset-layout">重置</button>
                </div>
              </section>
              <input
                type="file"
                data-role="settings-import-config"
                accept="application/json"
                hidden
              />
              <input
                type="file"
                data-role="settings-import-data"
                accept="application/json"
                hidden
              />
            </form>
            <div class="chaospace-settings-footer">
              <button type="button" data-role="settings-cancel">取消</button>
              <button type="submit" class="chaospace-settings-save" form="chaospace-settings-form">
                保存设置
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="chaospace-float-main">
        <div class="chaospace-float-columns">
          <section class="chaospace-column chaospace-column-left">
            <div class="chaospace-section-heading">
              <div class="chaospace-section-title" data-role="resource-title"></div>
              <div class="chaospace-section-caption" data-role="resource-summary"></div>
            </div>
            <div class="chaospace-season-tabs" data-role="season-tabs" hidden></div>
            <div class="chaospace-toolbar">
              <div class="chaospace-sort-group">
                <div class="chaospace-sort-label">
                  <span>排序</span>
                  <div
                    class="chaospace-segmented chaospace-segmented--toolbar"
                    data-role="sort-key"
                    role="radiogroup"
                    aria-label="资源排序"
                  >
                    <button
                      type="button"
                      class="chaospace-segmented-option"
                      data-value="page"
                      role="radio"
                      aria-checked="false"
                    >
                      默认顺序
                    </button>
                    <button
                      type="button"
                      class="chaospace-segmented-option"
                      data-value="title"
                      role="radio"
                      aria-checked="false"
                    >
                      标题
                    </button>
                  </div>
                </div>
                <button type="button" class="chaospace-order-btn" data-role="sort-order">
                  正序
                </button>
              </div>
              <div class="chaospace-select-group">
                <button type="button" data-action="select-all">全选</button>
                <button type="button" data-action="select-invert">反选</button>
                <button type="button" data-action="select-new">仅选新增</button>
              </div>
            </div>
            <div class="chaospace-items-scroll" data-role="items"></div>
          </section>
          <section class="chaospace-column chaospace-column-right">
            <div class="chaospace-card chaospace-path-card">
              <div class="chaospace-card-title">📁 转存目录</div>
              <div class="chaospace-card-body">
                <div class="chaospace-preset-list" data-role="preset-list"></div>
                <div class="chaospace-input-row">
                  <input type="text" placeholder="/视频/番剧" data-role="base-dir" />
                  <button type="button" data-role="add-preset">收藏路径</button>
                </div>
                <label class="chaospace-checkbox">
                  <input type="checkbox" data-role="use-title" />
                  <span>为本页创建子目录（推荐）</span>
                </label>
                <label
                  class="chaospace-checkbox chaospace-season-checkbox"
                  data-role="season-row"
                  style="display: none"
                >
                  <input type="checkbox" data-role="use-season" />
                  <span>为每季创建子文件夹</span>
                </label>
                <div class="chaospace-path-preview" data-role="path-preview"></div>
                <div class="chaospace-path-hint is-empty" data-role="season-path-hint"></div>
              </div>
            </div>
            <div class="chaospace-card chaospace-status-card">
              <div class="chaospace-card-title chaospace-log-header">
                <span class="chaospace-log-title">📜 日志</span>
                <div class="chaospace-log-summary is-empty" data-role="result-summary"></div>
              </div>
              <div class="chaospace-log-container" data-role="log-container">
                <ul class="chaospace-log-list" data-role="log-list"></ul>
              </div>
            </div>
          </section>
        </div>
      </div>
      <div class="chaospace-float-footer">
        <div class="chaospace-history-summary" data-role="history-summary">
          <div class="chaospace-history-summary-body" data-role="history-summary-body"></div>
        </div>
        <div class="chaospace-transfer-card chaospace-footer-actions">
          <button class="chaospace-float-btn chaospace-float-btn-compact" data-role="transfer-btn">
            <span class="chaospace-btn-spinner" data-role="transfer-spinner"></span>
            <span data-role="transfer-label">开始转存</span>
            <span class="chaospace-btn-icon">🚀</span>
          </button>
        </div>
      </div>
    </div>
    <div
      class="chaospace-resize-handle"
      data-role="resize-handle"
      title="拖动调整面板大小"
      aria-hidden="true"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type PanelTheme = 'light' | 'dark'

const props = withDefaults(
  defineProps<{
    pageTitle?: string
    originLabel?: string
    theme?: PanelTheme
  }>(),
  {
    pageTitle: '',
    originLabel: '',
    theme: 'dark',
  },
)

const safeTitle = computed(() => props.pageTitle?.trim() || '等待选择剧集')
const subtitle = computed(() => {
  const label = props.originLabel?.trim()
  return label ? `来源 ${label}` : '未检测到页面来源'
})

const panelClasses = computed(() => ({
  'chaospace-float-panel': true,
  'chaospace-theme': true,
  'theme-light': props.theme === 'light',
}))
</script>
