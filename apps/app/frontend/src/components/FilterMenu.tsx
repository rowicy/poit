import { createSignal, onCleanup, Show, type Component, type JSX } from "solid-js";
import type { ArtifactMime, Visibility } from "../lib/api";

export type MimeFilter = ArtifactMime | "all";
export type VisibilityFilter = Visibility | "all";
export type PersistFilter = "all" | "persist" | "temporary";

export interface ArtifactFilters {
  mime: MimeFilter;
  visibility: VisibilityFilter;
  persist: PersistFilter;
}

export interface FilterMenuProps {
  filters: ArtifactFilters;
  onChange: (filters: ArtifactFilters) => void;
}

type FilterKey = "mime" | "visibility" | "persist";

const HOVER_CLOSE_DELAY_MS = 250;

const MIME_OPTIONS: { value: MimeFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "md", label: "md" },
  { value: "html", label: "html" },
  { value: "txt", label: "txt" },
];

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "public", label: "公開" },
  { value: "private", label: "非公開" },
];

const PERSIST_OPTIONS: { value: PersistFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "persist", label: "永続のみ" },
  { value: "temporary", label: "一時のみ" },
];

const FilterMenu: Component<FilterMenuProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [submenu, setSubmenu] = createSignal<FilterKey | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let rootRef: HTMLDivElement | undefined;
  // See OptionsMenu.tsx: a real mouse click fires mouseenter (opens) just
  // before the click event, so the click handler must not blindly toggle or
  // it would immediately close what hover just opened.
  let openedByHover = false;

  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(() => {
      setOpen(false);
      setSubmenu(null);
    }, HOVER_CLOSE_DELAY_MS);
  }

  function onDocumentClick(e: MouseEvent) {
    if (rootRef && !rootRef.contains(e.target as Node)) {
      setOpen(false);
      setSubmenu(null);
    }
  }
  document.addEventListener("click", onDocumentClick);
  onCleanup(() => {
    document.removeEventListener("click", onDocumentClick);
    cancelClose();
  });

  const activeCount = () =>
    (props.filters.mime !== "all" ? 1 : 0) +
    (props.filters.visibility !== "all" ? 1 : 0) +
    (props.filters.persist !== "all" ? 1 : 0);

  const activeLabels = () => {
    const labels: string[] = [];
    if (props.filters.mime !== "all") labels.push(MIME_OPTIONS.find((o) => o.value === props.filters.mime)!.label);
    if (props.filters.visibility !== "all")
      labels.push(VISIBILITY_OPTIONS.find((o) => o.value === props.filters.visibility)!.label);
    if (props.filters.persist !== "all")
      labels.push(PERSIST_OPTIONS.find((o) => o.value === props.filters.persist)!.label);
    return labels;
  };

  let submenuOpenedByHover = false;
  function toggleSubmenu(key: FilterKey) {
    setSubmenu((s) => (s === key ? null : key));
  }
  function submenuTriggerProps(key: FilterKey): JSX.HTMLAttributes<HTMLDivElement> {
    return {
      role: "button",
      tabIndex: 0,
      "aria-haspopup": "menu",
      "aria-expanded": submenu() === key,
      onMouseEnter: () => {
        setSubmenu(key);
        submenuOpenedByHover = true;
      },
      onMouseLeave: () => {
        submenuOpenedByHover = false;
      },
      onClick: () => {
        if (submenuOpenedByHover) {
          submenuOpenedByHover = false;
          return;
        }
        toggleSubmenu(key);
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSubmenu(key);
        }
      },
    };
  }

  function currentLabel(key: FilterKey): string {
    if (key === "mime") return MIME_OPTIONS.find((o) => o.value === props.filters.mime)!.label;
    if (key === "visibility") return VISIBILITY_OPTIONS.find((o) => o.value === props.filters.visibility)!.label;
    return PERSIST_OPTIONS.find((o) => o.value === props.filters.persist)!.label;
  }

  return (
    <div
      class="options-menu filter-menu"
      ref={rootRef}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
        openedByHover = true;
      }}
      onMouseLeave={() => {
        openedByHover = false;
        scheduleClose();
      }}
    >
      <button
        type="button"
        class="ghost options-trigger"
        title="絞り込み"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => {
          if (openedByHover) {
            openedByHover = false;
            return;
          }
          setOpen((v) => !v);
        }}
      >
        <span class="options-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M3 5h18M6 12h12M10 19h4"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span>絞り込み</span>
        <Show when={activeCount() > 0}>
          <span class="options-badges">
            {activeLabels().map((label) => (
              <span class="options-badge">{label}</span>
            ))}
          </span>
        </Show>
      </button>
      <div class="options-popover" classList={{ open: open() }}>
        <div class="options-row">
          <div class="options-item" {...submenuTriggerProps("mime")}>
            <span>種別</span>
            <span class="options-current">{currentLabel("mime")} ▸</span>
          </div>
          <Show when={submenu() === "mime"}>
            <div class="options-submenu">
              {MIME_OPTIONS.map((o) => (
                <button
                  type="button"
                  classList={{ active: props.filters.mime === o.value }}
                  onClick={() => props.onChange({ ...props.filters, mime: o.value })}
                >
                  {o.label} {props.filters.mime === o.value ? "✓" : ""}
                </button>
              ))}
            </div>
          </Show>
        </div>

        <div class="options-row">
          <div class="options-item" {...submenuTriggerProps("visibility")}>
            <span>公開設定</span>
            <span class="options-current">{currentLabel("visibility")} ▸</span>
          </div>
          <Show when={submenu() === "visibility"}>
            <div class="options-submenu">
              {VISIBILITY_OPTIONS.map((o) => (
                <button
                  type="button"
                  classList={{ active: props.filters.visibility === o.value }}
                  onClick={() => props.onChange({ ...props.filters, visibility: o.value })}
                >
                  {o.label} {props.filters.visibility === o.value ? "✓" : ""}
                </button>
              ))}
            </div>
          </Show>
        </div>

        <div class="options-row">
          <div class="options-item" {...submenuTriggerProps("persist")}>
            <span>永続化</span>
            <span class="options-current">{currentLabel("persist")} ▸</span>
          </div>
          <Show when={submenu() === "persist"}>
            <div class="options-submenu">
              {PERSIST_OPTIONS.map((o) => (
                <button
                  type="button"
                  classList={{ active: props.filters.persist === o.value }}
                  onClick={() => props.onChange({ ...props.filters, persist: o.value })}
                >
                  {o.label} {props.filters.persist === o.value ? "✓" : ""}
                </button>
              ))}
            </div>
          </Show>
        </div>

        <Show when={activeCount() > 0}>
          <button
            type="button"
            class="filter-reset"
            onClick={() => props.onChange({ mime: "all", visibility: "all", persist: "all" })}
          >
            フィルターを解除
          </button>
        </Show>
      </div>
    </div>
  );
};

export default FilterMenu;
