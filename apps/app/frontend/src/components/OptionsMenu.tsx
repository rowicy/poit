import { createSignal, Show, onCleanup, type Component, type JSX } from "solid-js";
import type { ArtifactMime, Visibility } from "../lib/api";

export interface OptionsMenuProps {
  visibility: Visibility;
  persist: boolean;
  slug: string;
  showSlug: boolean;
  mime?: ArtifactMime;
  showMime?: boolean;
  /** Visible text next to the gear icon (e.g. "Option"); omit for icon-only. */
  label?: string;
  onVisibilityChange: (v: Visibility) => void;
  onPersistChange: (p: boolean) => void;
  onSlugChange: (s: string) => void;
  onMimeChange?: (m: ArtifactMime) => void;
}

type SubmenuKey = "visibility" | "persist" | "mime";

const DEFAULT_VISIBILITY: Visibility = "private";
const DEFAULT_PERSIST = false;

const HOVER_CLOSE_DELAY_MS = 250;

const OptionsMenu: Component<OptionsMenuProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [submenu, setSubmenu] = createSignal<SubmenuKey | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let rootRef: HTMLDivElement | undefined;
  // A normal mouse click starts outside the trigger, so it fires mouseenter
  // (which opens the popover) immediately before the click event itself. If
  // the click handler then toggled unconditionally, it would immediately
  // flip the just-opened popover shut again, and mouse users could never
  // open it - see the flow below.
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

  // Touch devices fire mouseenter (opening the popover) on tap, but never
  // mouseleave on releasing it - the hover-close path above never runs, so
  // without this a tap outside left the popover stuck open indefinitely
  // (verified live). Same outside-tap-close pattern already used by
  // FilterMenu/ShareTrigger/ArtifactRow.
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

  const isChanged = () =>
    props.visibility !== DEFAULT_VISIBILITY || props.persist !== DEFAULT_PERSIST || props.slug.length > 0;

  const changeBadges = () => {
    const badges: string[] = [];
    if (props.visibility !== DEFAULT_VISIBILITY) badges.push("公開");
    if (props.persist !== DEFAULT_PERSIST) badges.push("永続");
    if (props.slug) badges.push(props.slug);
    return badges;
  };

  // Hover opens a submenu for mouse users, but also needs a click/tap and
  // keyboard path - touch devices never fire mouseenter, and a plain <div>
  // is otherwise unreachable by keyboard.
  let submenuOpenedByHover = false;
  function toggleSubmenu(key: SubmenuKey) {
    setSubmenu((s) => (s === key ? null : key));
  }
  function submenuTriggerProps(key: SubmenuKey): JSX.HTMLAttributes<HTMLDivElement> {
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
      // A mouse click landing on a not-yet-hovered row fires mouseenter
      // (opening it) right before this click - same race as the top-level
      // trigger above, so the click that merely arrived here must not
      // immediately toggle the submenu back shut.
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

  return (
    <div
      class="options-menu"
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
        title="オプション"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => {
          // Swallow the click that immediately follows a hover-open (see
          // note above) instead of toggling it straight back shut; a
          // deliberate second click (no fresh mouseenter in between) still
          // toggles closed as normal.
          if (openedByHover) {
            openedByHover = false;
            return;
          }
          setOpen((v) => !v);
        }}
      >
        <span class="options-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <Show when={props.label}>
          <span class="options-label">{props.label}</span>
        </Show>
        <Show when={isChanged()}>
          <span class="options-badges">
            {changeBadges().map((b) => (
              <span class="options-badge">{b}</span>
            ))}
          </span>
        </Show>
      </button>
      <div class="options-popover" classList={{ open: open() }}>
        <div class="options-row">
          <div class="options-item" {...submenuTriggerProps("visibility")}>
            <span>公開設定</span>
            <span class="options-current">{props.visibility === "public" ? "パブリック" : "プライベート"} ▸</span>
          </div>
          <Show when={submenu() === "visibility"}>
            <div class="options-submenu">
              <button type="button" classList={{ active: props.visibility === "private" }} onClick={() => props.onVisibilityChange("private")}>
                プライベート (rowicy内) {props.visibility === "private" ? "✓" : ""}
              </button>
              <button type="button" classList={{ active: props.visibility === "public" }} onClick={() => props.onVisibilityChange("public")}>
                パブリック (誰でも閲覧可) {props.visibility === "public" ? "✓" : ""}
              </button>
            </div>
          </Show>
        </div>

        <div class="options-row">
          <div class="options-item" {...submenuTriggerProps("persist")}>
            <span>永続化</span>
            <span class="options-current">{props.persist ? "オン" : "オフ"} ▸</span>
          </div>
          <Show when={submenu() === "persist"}>
            <div class="options-submenu">
              <button type="button" classList={{ active: !props.persist }} onClick={() => props.onPersistChange(false)}>
                オフ (90日で自動削除) {!props.persist ? "✓" : ""}
              </button>
              <button type="button" classList={{ active: props.persist }} onClick={() => props.onPersistChange(true)}>
                オン (永続) {props.persist ? "✓" : ""}
              </button>
            </div>
          </Show>
        </div>

        <Show when={props.showMime}>
          <div class="options-row">
            <div class="options-item" {...submenuTriggerProps("mime")}>
              <span>ファイル種別</span>
              <span class="options-current">{props.mime ?? "txt"} ▸</span>
            </div>
            <Show when={submenu() === "mime"}>
              <div class="options-submenu">
                {(["md", "html", "txt"] as ArtifactMime[]).map((m) => (
                  <button type="button" classList={{ active: props.mime === m }} onClick={() => props.onMimeChange?.(m)}>
                    {m} {props.mime === m ? "✓" : ""}
                  </button>
                ))}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={props.showSlug}>
          <div class="options-item options-slug-row" onMouseEnter={() => setSubmenu(null)}>
            <span>カスタムURL</span>
            <input
              type="text"
              class="slug-input"
              placeholder="例: my-doc-1"
              value={props.slug}
              onInput={(e) => props.onSlugChange(e.currentTarget.value.toLowerCase())}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default OptionsMenu;
