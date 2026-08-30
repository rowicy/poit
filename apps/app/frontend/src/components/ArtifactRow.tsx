import { createSignal, onCleanup, type Component } from "solid-js";
import type { ArtifactMeta, ArtifactMime, Visibility } from "../lib/api";
import OptionsMenu from "./OptionsMenu";

export interface ArtifactRowProps {
  artifact: ArtifactMeta;
  onEdit: (a: ArtifactMeta) => void;
  onDelete: (id: string) => void;
  onSettingsChange: (id: string, patch: { visibility?: Visibility; persist?: boolean; mime?: ArtifactMime }) => void;
}

function visibilityLabel(v: Visibility): string {
  return v === "public" ? "公開" : "非公開";
}

const ArtifactRow: Component<ArtifactRowProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  function onDocumentClick(e: MouseEvent) {
    if (rootRef && !rootRef.contains(e.target as Node)) setMenuOpen(false);
  }
  document.addEventListener("click", onDocumentClick);
  onCleanup(() => document.removeEventListener("click", onDocumentClick));

  return (
    <li>
      <a href={`/artifact/${props.artifact.id}`} class="artifact-link">
        <span class="artifact-text">
          <span class="artifact-title">{props.artifact.title || props.artifact.filename}</span>
          {props.artifact.excerpt && <span class="artifact-excerpt">{props.artifact.excerpt}</span>}
        </span>
        <span class="badge">
          {props.artifact.mime} · {visibilityLabel(props.artifact.visibility)}
          {props.artifact.persist ? " · 永続" : ""}
        </span>
      </a>
      <div class="item-menu" classList={{ open: menuOpen() }} ref={rootRef}>
        <button
          type="button"
          class="ghost menu-trigger"
          aria-label="操作メニュー"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>
        <div class="menu-popover">
          <button
            type="button"
            onClick={() => {
              props.onEdit(props.artifact);
              setMenuOpen(false);
            }}
          >
            編集
          </button>
          <div class="menu-settings-row">
            <OptionsMenu
              visibility={props.artifact.visibility}
              persist={props.artifact.persist}
              mime={props.artifact.mime}
              showMime
              slug=""
              showSlug={false}
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
