:root {
  color-scheme: light;
  --bg: #eef2f7;
  --surface: #ffffff;
  --surface-soft: #f8fafc;
  --surface-raised: #f1f5f9;
  --text: #172033;
  --muted: #64748b;
  --border: #cbd5e1;
  --border-strong: #94a3b8;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-soft: #eff6ff;
  --selected: #dbeafe;
  --selected-text: #172033;
  --danger: #dc2626;
  --danger-soft: #fee2e2;
  --warning-soft: #fef3c7;
  --success: #16a34a;
  --input: #ffffff;
  --shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
  --left-width: 250px;
  --right-width: 330px;
  --history-height: 38%;
  --menu-height: 36px;
  --header-height: 86px;
  font-family: "Segoe UI", Arial, sans-serif;
  font-size: 14px;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111827;
  --surface: #1f2937;
  --surface-soft: #182231;
  --surface-raised: #263244;
  --text: #f8fafc;
  --muted: #a8b3c7;
  --border: #3a4a61;
  --border-strong: #64748b;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --primary-soft: #172f50;
  --selected: #1e426d;
  --selected-text: #ffffff;
  --danger: #ef4444;
  --danger-soft: #562327;
  --warning-soft: #554317;
  --success: #22c55e;
  --input: #111b2a;
  --shadow: 0 18px 55px rgba(0, 0, 0, 0.4);
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}

button,
input,
select,
textarea {
  font: inherit;
  letter-spacing: 0;
}

button {
  color: inherit;
}

[hidden] {
  display: none !important;
}

.app-shell {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: var(--menu-height) var(--header-height) minmax(0, 1fr);
  background: var(--bg);
}

.menu-bar {
  position: relative;
  z-index: 50;
  display: flex;
  align-items: stretch;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-soft);
}

.menu-group {
  position: relative;
}

.menu-trigger {
  height: 100%;
  padding: 0 10px;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.menu-trigger:hover,
.menu-trigger.is-open {
  background: var(--surface-raised);
}

.menu-popover {
  position: absolute;
  top: calc(100% - 1px);
  left: 0;
  min-width: 220px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 0 0 7px 7px;
  background: var(--surface);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
}

.menu-popover button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.menu-popover button:hover {
  background: var(--surface-raised);
}

.table-context-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 80;
  min-width: 190px;
  border-radius: 7px;
}

.table-context-menu .context-danger {
  color: var(--danger);
}

.modal-message {
  margin: 2px 0 14px;
  color: var(--muted);
  line-height: 1.5;
}

.menu-separator {
  height: 1px;
  margin: 5px 3px;
  background: var(--border);
}

.menu-check {
  width: 12px;
  color: var(--primary);
}

.app-header {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.brand-mark,
.auth-logo {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: var(--primary);
}

.brand-mark {
  width: 48px;
  height: 48px;
}

.brand-mark::before,
.brand-mark::after,
.auth-logo::before,
.auth-logo::after,
.brand-mark span,
.auth-logo span {
  position: absolute;
  content: "";
  background: #ffffff;
}

.brand-mark::before,
.auth-logo::before {
  width: 19px;
  height: 14px;
  border: 2px solid #ffffff;
  border-top: 0;
  background: transparent;
}

.brand-mark::after,
.auth-logo::after {
  width: 17px;
  height: 2px;
  transform: translateY(-9px);
}

.brand-mark span,
.auth-logo span {
  width: 2px;
  height: 5px;
  transform: translate(5px, -6px);
}

.brand-copy {
  min-width: 0;
}

.brand-copy h1 {
  margin: 0;
  font-size: 22px;
}

.brand-copy p {
  margin: 5px 0 0;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

#json-file-button {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.button {
  min-height: 36px;
  padding: 7px 13px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
  cursor: pointer;
}

.button:hover {
  border-color: var(--primary);
  background: var(--surface-raised);
}

.button-primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #ffffff;
}

.button-primary:hover {
  border-color: var(--primary-hover);
  background: var(--primary-hover);
}

.button-danger {
  border-color: var(--danger);
  background: var(--danger);
  color: #ffffff;
}

.button-danger:hover {
  background: #b91c1c;
}

.button.compact {
  min-height: 34px;
  padding-inline: 12px;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-button {
  display: inline-grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.icon-button:hover {
  border-color: var(--border);
  background: var(--surface-raised);
  color: var(--primary);
}

.workspace-shell {
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.dockview-root {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  --dv-tabs-and-actions-container-height: 38px;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-border-radius: 7px;
  --dv-drag-over-background-color: color-mix(in srgb, var(--primary) 24%, transparent);
  --dv-drag-over-border-color: var(--primary);
}

.dockview-root.dockview-theme-light,
.dockview-root.dockview-theme-dark {
  --dv-background-color: var(--bg);
  --dv-paneview-active-outline-color: var(--primary);
  --dv-tabs-and-actions-container-background-color: var(--bg);
  --dv-activegroup-visiblepanel-tab-background-color: var(--surface);
  --dv-activegroup-hiddenpanel-tab-background-color: var(--bg);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--surface);
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--bg);
  --dv-tab-divider-color: var(--border);
  --dv-activegroup-visiblepanel-tab-color: var(--primary);
  --dv-activegroup-hiddenpanel-tab-color: var(--muted);
  --dv-inactivegroup-visiblepanel-tab-color: var(--text);
  --dv-inactivegroup-hiddenpanel-tab-color: var(--muted);
  --dv-separator-border: var(--border);
}

.dockview-root .dv-view-container,
.dockview-root .dv-content-container,
.dockview-root .dv-content-container > div {
  min-width: 0;
  min-height: 0;
}

.dockview-root .dv-content-container {
  background: var(--surface);
}

.dockview-root .dv-sash-container .dv-sash {
  z-index: 7;
}

.dockview-root .dv-tab {
  letter-spacing: 0;
}

.dock-panel-body {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
}

#lists-panel.dock-panel-body,
#users-panel.dock-panel-body {
  display: flex;
  flex-direction: column;
}

#stock-card-panel.dock-panel-body,
#movement-panel.dock-panel-body {
  overflow: auto;
}

.history-dock.dock-panel-body {
  border: 0;
}

.dock {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  background: var(--surface);
  overflow: hidden;
}

.dock-left,
.dock-center,
.right-dock {
  border-top: 0;
}

.dock-left {
  display: grid;
  grid-template-rows: 39px minmax(0, 1fr);
}

.dock-center {
  display: grid;
  grid-template-rows: auto 37px minmax(0, 1fr);
}

.right-dock {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(80px, calc(100% - var(--history-height) - 5px)) 5px minmax(70px, var(--history-height));
  overflow: hidden;
}

.right-top-dock {
  display: grid;
  grid-template-rows: 39px minmax(0, 1fr);
}

.history-dock {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.dock-tabs,
.open-table-tabs {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.dock-tab,
.table-tab {
  position: relative;
  height: 38px;
  min-width: 0;
  padding: 0 12px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 7px 7px 0 0;
  background: transparent;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.dock-tab:hover,
.table-tab:hover {
  background: var(--surface-raised);
  color: var(--text);
}

.dock-tab.is-active,
.table-tab.is-active {
  z-index: 1;
  border-color: var(--border);
  background: var(--surface);
  color: var(--primary);
}

.dock-tab.is-active::after,
.table-tab.is-active::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  content: "";
  background: var(--primary);
}

.dock-collapse {
  margin: 4px 5px 4px auto;
}

.dock-content {
  min-width: 0;
  min-height: 0;
  padding: 12px 14px;
  background: var(--surface);
  overflow: auto;
}

.section-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.section-heading h2,
.stock-toolbar h2 {
  margin: 0;
  font-size: 16px;
}

.muted {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.control,
.small-select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: 0;
  background: var(--input);
  color: var(--text);
}

.control {
  min-height: 36px;
  padding: 7px 9px;
}

.small-select {
  width: auto;
  min-height: 30px;
  padding: 4px 24px 4px 7px;
}

.control:focus,
.small-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent);
}

textarea.control {
  resize: vertical;
}

.table-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.table-list {
  min-height: 120px;
  border-bottom: 1px solid var(--border);
}

.table-list-item {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 9px 8px;
  border: 0;
  border-radius: 0;
  outline: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.table-list-item:hover {
  background: var(--surface-soft);
}

.table-list-item.is-active {
  background: var(--selected);
}

.table-list-item span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-list-item .table-count {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 11px;
}

.panel-footer-actions {
  display: grid;
  gap: 7px;
  margin-top: 12px;
}

.users-panel {
  display: flex;
  flex-direction: column;
}

.users-panel[hidden] {
  display: none;
}

.user-list {
  display: grid;
  gap: 7px;
}

.user-list-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 92px;
  align-items: center;
  gap: 9px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.user-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  background: var(--primary);
  color: #ffffff;
  font-weight: 700;
}

.user-identity {
  display: grid;
  min-width: 0;
}

.user-identity strong,
.user-identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-identity small {
  margin-top: 2px;
  color: var(--muted);
}

.user-role-select {
  width: 92px;
  min-width: 0;
  min-height: 32px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input);
  color: var(--text);
}

.permission-note {
  margin-top: auto;
  padding-top: 14px;
}

.splitter {
  position: relative;
  z-index: 5;
  background: var(--bg);
}

.splitter::after {
  position: absolute;
  content: "";
  border-radius: 5px;
  background: transparent;
}

.splitter:hover::after,
.splitter.is-dragging::after {
  background: var(--primary);
}

.splitter-vertical {
  cursor: col-resize;
}

.splitter-vertical::after {
  inset: 10px 1px;
}

.splitter-horizontal {
  cursor: row-resize;
}

.splitter-horizontal::after {
  inset: 1px 10px;
}

.stock-toolbar {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(190px, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--surface);
}

.search-field {
  position: relative;
  min-width: 0;
}

.search-field input {
  width: 100%;
  height: 36px;
  padding: 7px 10px 7px 33px;
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: 0;
  background: var(--input);
  color: var(--text);
}

.search-field input:focus {
  border-color: var(--primary);
}

.search-icon {
  position: absolute;
  top: 10px;
  left: 11px;
  width: 13px;
  height: 13px;
  border: 2px solid var(--muted);
  border-radius: 50%;
}

.search-icon::after {
  position: absolute;
  right: -5px;
  bottom: -3px;
  width: 6px;
  height: 2px;
  content: "";
  transform: rotate(45deg);
  background: var(--muted);
}

.check-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  cursor: pointer;
}

input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--primary);
}

.open-table-tabs {
  padding-left: 7px;
  background: var(--bg);
}

.table-tab {
  display: inline-flex;
  max-width: 230px;
  align-items: center;
  gap: 9px;
}

.table-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  display: inline-grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.tab-close:hover {
  background: var(--surface-raised);
  color: var(--danger);
}

.table-region,
.history-table-wrap,
.bom-table-wrap {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--surface);
}

.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  color: var(--text);
  font-size: 12px;
}

.data-table th {
  position: sticky;
  z-index: 2;
  top: 0;
  height: 38px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--muted);
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
  cursor: default;
}

.stock-table th[data-key]:not([data-key="select"]) {
  cursor: pointer;
}

.stock-table th[draggable="true"] {
  user-select: none;
}

.stock-table th.is-dragging {
  opacity: 0.4;
}

.stock-table th.drop-before {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--primary) 70%, transparent);
}

.stock-table th.drop-after {
  box-shadow: inset -3px 0 0 color-mix(in srgb, var(--primary) 70%, transparent);
}

.sort-indicator {
  margin-left: 5px;
  color: var(--primary);
}

.data-table td {
  height: 34px;
  max-width: 260px;
  padding: 6px 10px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-table tbody tr {
  background: var(--surface);
}

.data-table tbody tr:nth-child(even) {
  background: var(--surface-soft);
}

.data-table tbody tr:hover {
  background: var(--primary-soft);
}

.data-table tbody tr.stock-warning {
  background: var(--warning-soft);
  box-shadow: inset 4px 0 #d97706;
}

.data-table tbody tr.stock-critical {
  background: var(--danger-soft);
  box-shadow: inset 4px 0 var(--danger);
}

.data-table tbody tr.is-selected {
  background: var(--selected);
  color: var(--selected-text);
}

.data-table tbody tr.is-selected.stock-warning {
  box-shadow: inset 4px 0 #d97706;
}

.data-table tbody tr.is-selected.stock-critical {
  box-shadow: inset 4px 0 var(--danger);
}

.select-cell {
  width: 45px;
  text-align: center;
  cursor: pointer;
}

.select-cell input {
  pointer-events: none;
}

.columns-button {
  width: 38px;
  padding: 0;
  color: var(--primary);
  font-size: 18px;
  text-align: center !important;
  cursor: pointer !important;
}

.empty-state {
  display: grid;
  place-content: center;
  gap: 5px;
  color: var(--muted);
  text-align: center;
}

.empty-state strong {
  color: var(--text);
}

.form-panel {
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px 12px;
}

.form-grid label,
.auth-form-area form > label {
  display: grid;
  min-width: 0;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}

.form-span {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  gap: 7px;
  margin-top: auto;
  padding-top: 14px;
}

.movement-form {
  display: grid;
  min-width: 0;
  grid-template-columns: 126px minmax(0, 1fr);
  align-items: center;
  gap: 11px 10px;
  font-size: 12px;
}

.movement-form > span,
.movement-form > label {
  color: var(--muted);
}

.movement-submit {
  width: 100%;
  margin-top: auto;
}

.ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-heading {
  margin: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.history-table {
  min-width: 860px;
}

.modal-overlay {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(2px);
}

.auth-dialog {
  display: grid;
  width: min(850px, 96vw);
  min-height: 560px;
  grid-template-columns: 280px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: 9px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.auth-brand {
  display: flex;
  flex-direction: column;
  padding: 34px 28px;
  background: #2556d8;
  color: #ffffff;
}

.auth-logo {
  width: 58px;
  height: 58px;
  margin-bottom: 26px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.11);
}

.auth-brand strong {
  font-size: 31px;
  line-height: 1.25;
}

.auth-brand small {
  display: block;
  margin-top: 16px;
  color: #dbeafe;
}

.auth-brand p {
  margin-top: auto;
  color: #dbeafe;
  font-size: 12px;
}

.auth-form-area {
  padding: 42px 38px 28px;
  background: var(--surface);
}

.auth-form-area h2 {
  margin: 0;
  font-size: 28px;
}

.auth-tabs {
  display: flex;
  gap: 8px;
  margin: 18px 0 22px;
  border-bottom: 1px solid var(--border);
}

.json-file-setup {
  display: grid;
  gap: 10px;
  margin-top: 18px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.json-file-setup span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.json-file-setup strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-file-actions {
  display: flex;
  gap: 7px;
}

.json-file-actions .button {
  flex: 1;
}

.auth-tab {
  position: relative;
  padding: 9px 13px;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.auth-tab.is-active {
  color: var(--primary);
}

.auth-tab.is-active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  content: "";
  background: var(--primary);
}

.auth-form-area form {
  display: grid;
  gap: 14px;
}

.auth-submit {
  justify-self: end;
  min-width: 120px;
  margin-top: 8px;
}

.demo-credentials {
  margin-top: 18px;
  color: var(--muted);
  font-size: 12px;
}

.inline-error {
  padding: 9px 10px;
  border: 1px solid #ef4444;
  border-radius: 7px;
  background: var(--danger-soft);
  color: #b91c1c;
  font-size: 12px;
}

:root[data-theme="dark"] .inline-error {
  color: #fecaca;
}

.modal-dialog {
  width: min(520px, 96vw);
  max-height: 88vh;
  padding: 16px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.small-modal {
  width: min(430px, 96vw);
}

.bom-modal {
  display: grid;
  width: min(1120px, 96vw);
  height: min(720px, 90vh);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
}

#form-modal-fields {
  display: grid;
  gap: 12px;
}

#form-modal-fields label {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.columns-list {
  display: grid;
  gap: 3px;
}

.column-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
}

.column-option:hover {
  background: var(--surface-soft);
}

.bom-toolbar,
.bom-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bom-toolbar {
  padding-bottom: 10px;
}

.bom-footer {
  padding-top: 10px;
}

.bom-footer .control {
  flex: 1;
}

.bom-table-wrap {
  border: 1px solid var(--border);
  border-radius: 7px;
}

.bom-table-wrap .data-table {
  min-width: 900px;
}

.bom-unmatched {
  background: var(--danger-soft) !important;
}

.bom-ambiguous {
  background: var(--warning-soft) !important;
}

.toast-region {
  position: fixed;
  z-index: 200;
  right: 18px;
  bottom: 18px;
  display: grid;
  width: min(380px, calc(100vw - 36px));
  gap: 8px;
}

.toast {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: 7px;
  background: var(--surface);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  animation: toast-in 160ms ease-out;
}

.toast.is-error {
  border-left-color: var(--danger);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.app-shell.left-collapsed {
  --left-width: 48px !important;
}

.app-shell.right-collapsed {
  --right-width: 48px !important;
}

.left-collapsed .dock-left .dock-tab,
.left-collapsed .dock-left .dock-content,
.right-collapsed .right-top-dock .dock-tab,
.right-collapsed .right-top-dock .dock-content,
.right-collapsed .history-dock {
  display: none;
}

.left-collapsed .dock-left,
.right-collapsed .right-top-dock {
  grid-template-rows: 39px minmax(0, 1fr);
}

.left-collapsed .dock-collapse,
.right-collapsed .dock-collapse {
  margin: 4px auto;
}

.right-collapsed .right-dock {
  grid-template-rows: 1fr;
}

.right-collapsed #history-splitter {
  display: none;
}

@media (max-width: 980px) {
  :root {
    --left-width: 215px;
    --right-width: 285px;
  }

  .stock-toolbar {
    grid-template-columns: 1fr auto;
  }

  .search-field {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-span {
    grid-column: auto;
  }
}

@media (max-width: 760px) {
  html,
  body {
    overflow: auto;
  }

  .app-shell {
    min-width: 700px;
  }

  .auth-dialog {
    grid-template-columns: 1fr;
  }

  .auth-brand {
    min-height: 150px;
  }

  .auth-brand p {
    display: none;
  }
}
