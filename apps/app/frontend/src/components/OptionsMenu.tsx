import { createSignal, Show, onCleanup, type Component, type JSX } from "solid-js";
import type { ArtifactMime, Visibility } from "../lib/api";

export interface OptionsMenuProps {
  visibility: Visibility;
  persist: boolean;
  slug: string;
  showSlug: boolean;
  mime?: ArtifactMime;
  showMime?: boolean;
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

  onCleanup(cancelClose);

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
  function toggleSubmenu(key: SubmenuKey) {
    setSubmenu((s) => (s === key ? null : key));
  }
  function submenuTriggerProps(key: SubmenuKey): JSX.HTMLAttributes<HTMLDivElement> {
    return {
      role: "button",
      tabIndex: 0,
      onMouseEnter: () => setSubmenu(key),
      onClick: () => toggleSubmenu(key),
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
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button type="button" class="ghost options-trigger" title="オプション" onClick={() => setOpen((v) => !v)}>
        <span class="options-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
            <path
              d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
              stroke="currentColor"
              stroke-width="1.4"
            />
            <path
              d="M16.2 10a6.2 6.2 0 0 0-.08-1.02l1.36-1.06-1.3-2.25-1.6.54a6.3 6.3 0 0 0-1.76-1.02l-.24-1.67H9.92l-.24 1.67a6.3 6.3 0 0 0-1.76 1.02l-1.6-.54-1.3 2.25 1.36 1.06a6.2 6.2 0 0 0 0 2.04l-1.36 1.06 1.3 2.25 1.6-.54a6.3 6.3 0 0 0 1.76 1.02l.24 1.67h2.36l.24-1.67a6.3 6.3 0 0 0 1.76-1.02l1.6.54 1.3-2.25-1.36-1.06c.05-.34.08-.68.08-1.02Z"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <Show when={isChanged()}>
          <span class="options-badges">
            {changeBadges().map((b) => (
              <span class="options-badge">{b}</span>
            ))}
          </span>
        </Show>
      </button>
      <div class="options-popover" classList={{ open: open() }}>
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

        <Show when={props.showMime}>
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
