import { createSignal, Show, onCleanup, type Component } from "solid-js";
import type { Visibility } from "../lib/api";

export interface OptionsMenuProps {
  visibility: Visibility;
  persist: boolean;
  slug: string;
  showSlug: boolean;
  onVisibilityChange: (v: Visibility) => void;
  onPersistChange: (p: boolean) => void;
  onSlugChange: (s: string) => void;
}

const OptionsMenu: Component<OptionsMenuProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [submenu, setSubmenu] = createSignal<"visibility" | "persist" | null>(null);
  let rootRef: HTMLDivElement | undefined;

  function onDocumentClick(e: MouseEvent) {
    if (rootRef && !rootRef.contains(e.target as Node)) {
      setOpen(false);
      setSubmenu(null);
    }
  }
  document.addEventListener("click", onDocumentClick);
  onCleanup(() => document.removeEventListener("click", onDocumentClick));

  const summary = () =>
    `${props.visibility === "public" ? "公開" : "非公開"} ・ ${props.persist ? "永続" : "90日"}`;

  return (
    <div class="options-menu" ref={rootRef}>
      <button
        type="button"
        class="ghost options-trigger"
        title="オプション"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙ <span class="hint options-summary">{summary()}</span>
      </button>
      <Show when={open()}>
        <div class="options-popover">
          <div class="options-item" onClick={() => setSubmenu((s) => (s === "visibility" ? null : "visibility"))}>
            <span>公開設定</span>
            <span class="options-current">{props.visibility === "public" ? "パブリック" : "プライベート"} ▸</span>
          </div>
          <Show when={submenu() === "visibility"}>
            <div class="options-submenu">
              <button
                type="button"
                classList={{ active: props.visibility === "private" }}
                onClick={() => {
                  props.onVisibilityChange("private");
                  setSubmenu(null);
                }}
              >
                プライベート (rowicy内) {props.visibility === "private" ? "✓" : ""}
              </button>
              <button
                type="button"
                classList={{ active: props.visibility === "public" }}
                onClick={() => {
                  props.onVisibilityChange("public");
                  setSubmenu(null);
                }}
              >
                パブリック (誰でも閲覧可) {props.visibility === "public" ? "✓" : ""}
              </button>
            </div>
          </Show>

          <div class="options-item" onClick={() => setSubmenu((s) => (s === "persist" ? null : "persist"))}>
            <span>永続化</span>
            <span class="options-current">{props.persist ? "オン" : "オフ"} ▸</span>
          </div>
          <Show when={submenu() === "persist"}>
            <div class="options-submenu">
              <button
                type="button"
                classList={{ active: !props.persist }}
                onClick={() => {
                  props.onPersistChange(false);
                  setSubmenu(null);
                }}
              >
                オフ (90日で自動削除) {!props.persist ? "✓" : ""}
              </button>
              <button
                type="button"
                classList={{ active: props.persist }}
                onClick={() => {
                  props.onPersistChange(true);
                  setSubmenu(null);
                }}
              >
                オン (永続) {props.persist ? "✓" : ""}
              </button>
            </div>
          </Show>

          <Show when={props.showSlug}>
            <div class="options-item options-slug-row">
              <span>カスタムURL</span>
              <input
                type="text"
                class="slug-input"
                placeholder="例: MY-DOC-1"
                value={props.slug}
                onInput={(e) => props.onSlugChange(e.currentTarget.value.toUpperCase())}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default OptionsMenu;
