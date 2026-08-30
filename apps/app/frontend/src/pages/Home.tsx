import { createSignal, createEffect, createResource, For, Show, onCleanup, type Component } from "solid-js";
import { createStore } from "solid-js/store";
import {
  type ArtifactMeta,
  type ArtifactMime,
  type Visibility,
  createArtifact,
  deleteArtifact,
  listArtifacts,
  updateArtifact,
} from "../lib/api";
import { detectMime } from "../lib/filekind";
import OptionsMenu from "../components/OptionsMenu";
import EditModal from "../components/EditModal";
import ShareTrigger from "../components/ShareTrigger";
import GuideModal from "../components/GuideModal";
import Spinner from "../components/Spinner";
import ArtifactRow from "../components/ArtifactRow";

type Status = { kind: "error" | "success"; message: string; url?: string } | null;

// Keep in sync with apps/app/src/index.ts's SLUG_PATTERN and
// cli/poit/cmd/share.go's slugPattern.
const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const Home: Component = () => {
  const [initial] = createResource(async () => (await listArtifacts()).artifacts);
  const [store, setStore] = createStore<{ artifacts: ArtifactMeta[] }>({ artifacts: [] });

  // Sync the one-time initial fetch into the store; every later mutation
  // (create/edit/delete/settings change) patches the store directly instead
  // of re-fetching, so unrelated rows (and their open dropdowns) never
  // remount - see ARCHITECTURE.md's note on this bug.
  createEffect(() => {
    const data = initial();
    if (data) setStore("artifacts", data);
  });

  const [visibility, setVisibility] = createSignal<Visibility>("private");
  const [persist, setPersist] = createSignal(false);
  const [slug, setSlug] = createSignal("");

  const [dropContent, setDropContent] = createSignal<{ name: string; content: string } | null>(null);
  const [dropReading, setDropReading] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const [status, setStatus] = createSignal<Status>(null);
  const [guideOpen, setGuideOpen] = createSignal(false);

  const [editing, setEditing] = createSignal<ArtifactMeta | null>(null);

  let fileInputRef: HTMLInputElement | undefined;

  async function submit(content: string, filename?: string) {
    if (!content.trim()) {
      setStatus({ kind: "error", message: "内容が空です" });
      return;
    }
    const trimmedSlug = slug().trim();
    if (trimmedSlug && !SLUG_PATTERN.test(trimmedSlug)) {
      setStatus({ kind: "error", message: "カスタムURLは英小文字/数字/-/_のみ、1〜64文字で指定してください" });
      return;
    }
    setSharing(true);
    setStatus(null);
    try {
      const kind = await detectMime(content).catch(() => null);
      const { artifact, url } = await createArtifact(content, filename, {
        visibility: visibility(),
        persist: persist(),
        slug: trimmedSlug || undefined,
      });
      const copied = await copyToClipboard(url);
      setStatus({
        kind: "success",
        message: `${kind ? `(${kind}として検出) ` : ""}${
          copied ? "共有URLをコピーしました:" : "共有URLを作成しました(自動コピー失敗。リンクを手動でコピーしてください):"
        }`,
        url,
      });
      setSlug("");
      setStore("artifacts", (list) => [artifact, ...list]);
    } catch (err) {
      setStatus({ kind: "error", message: String((err as Error).message ?? err) });
    } finally {
      setSharing(false);
    }
  }

  async function fromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      await submit(text);
    } catch {
      setStatus({ kind: "error", message: "クリップボードの読み取りに失敗しました" });
    }
  }

  function fromFile() {
    fileInputRef?.click();
  }

  async function onFileChosen(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    await submit(await file.text(), file.name);
  }

  // Whole-page drag & drop. Content is read into a string the moment the
  // drop happens (not deferred to the confirm click), so there is no async
  // gap in which the file reference could go stale before Share is pressed.
  const [dragActive, setDragActive] = createSignal(false);
  let dragDepth = 0;
  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth++;
    setDragActive(true);
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragActive(false);
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    setDropReading(true);
    try {
      setDropContent({ name: file.name, content: await file.text() });
    } finally {
      setDropReading(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setDropContent(null);
      setGuideOpen(false);
    }
  }
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  async function handleDelete(id: string) {
    if (!confirm("このアーティファクトを削除しますか? この操作は取り消せません。")) return;
    try {
      await deleteArtifact(id);
      setStore("artifacts", (list) => list.filter((a) => a.id !== id));
    } catch (err) {
      setStatus({ kind: "error", message: String((err as Error).message ?? err) });
    }
  }

  async function handleSettingsChange(
    id: string,
    patch: { visibility?: Visibility; persist?: boolean; mime?: ArtifactMime }
  ) {
    try {
      await updateArtifact(id, patch);
      setStore("artifacts", (a) => a.id === id, patch);
    } catch (err) {
      setStatus({ kind: "error", message: String((err as Error).message ?? err) });
    }
  }

  function handleEditSaved(updated: ArtifactMeta) {
    setEditing(null);
    setStore("artifacts", (a) => a.id === updated.id, updated);
  }

  return (
    <div class="home" onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header class="site-header">
        <a href="/" class="brand">
          poit
        </a>
        <button type="button" class="ghost guide-link" onClick={() => setGuideOpen(true)}>
          使い方
        </button>
      </header>

      <input type="file" ref={fileInputRef} hidden onChange={onFileChosen} />

      <section class="share-field" classList={{ "drag-over": dragActive() }}>
        <div class="drop-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path
              d="M12 15V4m0 0 3.5 3.5M12 4 8.5 7.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>ここにファイルをドラッグ&ドロップ</span>
        </div>
        <div class="share-stack">
          <ShareTrigger sharing={sharing()} onClipboard={fromClipboard} onFile={fromFile} />
          <OptionsMenu
            visibility={visibility()}
            persist={persist()}
            slug={slug()}
            showSlug
            onVisibilityChange={setVisibility}
            onPersistChange={setPersist}
            onSlugChange={setSlug}
          />
        </div>
      </section>

      <Show when={status()}>
        {(s) => (
          <div classList={{ "share-result": s().kind === "success", error: s().kind === "error" }}>
            <p>{s().message}</p>
            <Show when={s().url}>
              <a href={s().url} target="_blank" rel="noopener">
                {s().url}
              </a>
            </Show>
          </div>
        )}
      </Show>

      <section class="card artifact-list-card">
        <h2>アップロード済みアーティファクト</h2>
        <Show when={!initial.loading} fallback={<Spinner label="読み込み中..." />}>
          <Show when={store.artifacts.length > 0} fallback={<p class="empty-state">まだ共有されたものはありません</p>}>
            <ul class="artifact-list">
              <For each={store.artifacts}>
                {(a) => (
                  <ArtifactRow
                    artifact={a}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                    onSettingsChange={handleSettingsChange}
                  />
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>

      <Show when={dropReading()}>
        <div class="modal-backdrop">
          <div class="modal">
            <Spinner label="ファイルを読み込み中..." />
          </div>
        </div>
      </Show>

      <Show when={dropContent()}>
        {(file) => (
          <div class="modal-backdrop" onClick={() => setDropContent(null)}>
            <div class="modal" onClick={(e) => e.stopPropagation()}>
              <h2>"{file().name}" を共有しますか?</h2>
              <div class="modal-actions">
                <button
                  type="button"
                  class="primary"
                  onClick={() => {
                    const f = file();
                    setDropContent(null);
                    submit(f.content, f.name);
                  }}
                >
                  Share!
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={guideOpen()}>
        <GuideModal onClose={() => setGuideOpen(false)} />
      </Show>

      <Show when={editing()}>
        {(a) => <EditModal artifact={a()} onClose={() => setEditing(null)} onSaved={handleEditSaved} />}
      </Show>
    </div>
  );
};

export default Home;
