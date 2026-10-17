import { createSignal, onCleanup, type Component } from "solid-js";
import { getArtifactJson, type ArtifactMeta, type ArtifactMime, type Visibility } from "../lib/api";
import { copyToClipboard } from "../lib/clipboard";
import OptionsMenu from "./OptionsMenu";

export interface ArtifactRowProps {
  artifact: ArtifactMeta;
  onDelete: (id: string) => void;
  onSettingsChange: (id: string, patch: { visibility?: Visibility; persist?: boolean; mime?: ArtifactMime }) => void;
}

const COPY_FLASH_MS = 1500;

const ArtifactRow: Component<ArtifactRowProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [copied, setCopied] = createSignal<"content" | "url" | null>(null);
  let rootRef: HTMLDivElement | undefined;

  function onDocumentClick(e: MouseEvent) {
    if (rootRef && !rootRef.contains(e.target as Node)) setMenuOpen(false);
  }
  document.addEventListener("click", onDocumentClick);
  onCleanup(() => document.removeEventListener("click", onDocumentClick));

  function onMenuKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && menuOpen()) {
      e.stopPropagation();
      setMenuOpen(false);
    }
  }

  function flashCopied(kind: "content" | "url") {
    setCopied(kind);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), COPY_FLASH_MS);
  }

  async function handleCopyUrl() {
    const url = `${location.origin}/artifact/${props.artifact.id}`;
    if (await copyToClipboard(url)) flashCopied("url");
  }

  async function handleCopyContent() {
    try {
      const { content } = await getArtifactJson(props.artifact.id);
      if (await copyToClipboard(content)) flashCopied("content");
    } catch {
      // Best-effort; the popover has no per-action error slot to surface this in.
    }
  }

  return (
    <li>
      <a href={`/artifact/${props.artifact.id}`} class="artifact-link">
        <span class="artifact-text">
          <span class="artifact-title">{props.artifact.title || props.artifact.filename}</span>
          {props.artifact.excerpt && <span class="artifact-excerpt">{props.artifact.excerpt}</span>}
        </span>
        <span class="badge">
          {props.artifact.mime}
          {/* Only private is marked. Public needs no badge: it's the state a
              shared link already implies, and a row with no lock reads as
              "anyone with the URL can open this" without extra wording. */}
          {props.artifact.visibility === "private" && (
            <>
              {" · "}
              <svg class="badge-lock" viewBox="0 0 24 24" width="12" height="12" fill="none" role="img" aria-label="非公開">
                <title>非公開</title>
                <rect x="4" y="10.5" width="16" height="10.5" rx="2" stroke="currentColor" stroke-width="1.6" />
                <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </>
          )}
          {props.artifact.persist ? " · 永続" : ""}
        </span>
      </a>
      <div class="item-menu" classList={{ open: menuOpen() }} ref={rootRef} onKeyDown={onMenuKeyDown}>
        <button
          type="button"
          class="ghost menu-trigger"
          aria-label="操作メニュー"
          aria-haspopup="menu"
          aria-expanded={menuOpen()}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>
        <div class="menu-popover">
          <button type="button" onClick={handleCopyContent}>
            {copied() === "content" ? "コピーしました" : "コンテンツをコピー"}
          </button>
          <button type="button" onClick={handleCopyUrl}>
            {copied() === "url" ? "コピーしました" : "URLをコピー"}
          </button>
          <div class="menu-settings-row">
            <OptionsMenu
              visibility={props.artifact.visibility}
              persist={props.artifact.persist}
              mime={props.artifact.mime}
              showMime
              slug=""
              showSlug={false}
              label="Option"
              onVisibilityChange={(v) => props.onSettingsChange(props.artifact.id, { visibility: v })}
              onPersistChange={(p) => props.onSettingsChange(props.artifact.id, { persist: p })}
              onMimeChange={(m) => props.onSettingsChange(props.artifact.id, { mime: m })}
              onSlugChange={() => {}}
            />
          </div>
          <button type="button" class="danger" onClick={() => props.onDelete(props.artifact.id)}>
            削除
          </button>
        </div>
      </div>
    </li>
  );
};

export default ArtifactRow;
