import {
  createSignal,
  createResource,
  For,
  Show,
  onCleanup,
  type Component,
} from "solid-js";
import {
  type ArtifactMeta,
  type Visibility,
  createArtifact,
  deleteArtifact,
  listArtifacts,
  updateArtifact,
} from "../lib/api";
import { detectMime } from "../lib/filekind";
import OptionsMenu from "../components/OptionsMenu";
import EditModal from "../components/EditModal";

type Status = { kind: "error" | "success"; message: string; url?: string } | null;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function visibilityLabel(v: Visibility): string {
  return v === "public" ? "公開" : "非公開";
}

const Home: Component = () => {
  const [artifacts, { refetch }] = createResource(async () => (await listArtifacts()).artifacts);

  const [visibility, setVisibility] = createSignal<Visibility>("private");
  const [persist, setPersist] = createSignal(false);
  const [slug, setSlug] = createSignal("");

  const [choosing, setChoosing] = createSignal(false);
  const [dropFile, setDropFile] = createSignal<File | null>(null);
  const [sharing, setSharing] = createSignal(false);
  const [status, setStatus] = createSignal<Status>(null);

  const [editing, setEditing] = createSignal<ArtifactMeta | null>(null);
  const [menuOpenId, setMenuOpenId] = createSignal<string | null>(null);

  let fileInputRef: HTMLInputElement | undefined;

  // Keep in sync with apps/app/src/index.ts's SLUG_PATTERN and
  // cli/poit/cmd/share.go's slugPattern.
  const SLUG_PATTERN = /^[A-Z0-9_-]{1,64}$/;

  async function submit(content: string, filename?: string) {
    setChoosing(false);
    setDropFile(null);
    if (!content.trim()) {
      setStatus({ kind: "error", message: "内容が空です" });
      return;
    }
    const trimmedSlug = slug().trim();
    if (trimmedSlug && !SLUG_PATTERN.test(trimmedSlug)) {
      setStatus({ kind: "error", message: "カスタムURLは英大文字/数字/-/_のみ、1〜64文字で指定してください" });
      return;
    }
    setSharing(true);
    setStatus(null);
    try {
      const kind = await detectMime(content).catch(() => null);
      const { url } = await createArtifact(content, filename, {
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
      await refetch();
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
      setChoosing(false);
      setStatus({ kind: "error", message: "クリップボードの読み取りに失敗しました" });
    }
  }

  function fromFile() {
    fileInputRef?.click();
  }

  async function onFileChosen(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) {
      setChoosing(false);
      return;
    }
    await submit(await file.text(), file.name);
  }

  // Whole-page drag & drop: dropping anywhere shows a single "Share!"
  // confirmation instead of submitting instantly, since a drop can happen
  // by accident.
  let dragDepth = 0;
  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth++;
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    const file = e.dataTransfer?.files?.[0];
    if (file) setDropFile(file);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setChoosing(false);
      setDropFile(null);
    }
  }
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  function closeMenu() {
    setMenuOpenId(null);
  }
  document.addEventListener("click", closeMenu);
  onCleanup(() => document.removeEventListener("click", closeMenu));

  async function handleDelete(id: string) {
    if (!confirm("このアーティファクトを削除しますか? この操作は取り消せません。")) return;
    try {
      await deleteArtifact(id);
      await refetch();
    } catch (err) {
      setStatus({ kind: "error", message: String((err as Error).message ?? err) });
    }
  }

  async function handleSettingsChange(a: ArtifactMeta, patch: { visibility?: Visibility; persist?: boolean }) {
    try {
      await updateArtifact(a.id, patch);
      await refetch();
    } catch (err) {
      setStatus({ kind: "error", message: String((err as Error).message ?? err) });
    }
  }

  return (
    <div class="home" onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header class="site-header">
        <a href="/" class="brand">
          poit
        </a>
      </header>

      <input type="file" ref={fileInputRef} hidden onChange={onFileChosen} />

      <section class="share-field">
        <OptionsMenu
          visibility={visibility()}
          persist={persist()}
          slug={slug()}
          showSlug
          onVisibilityChange={setVisibility}
          onPersistChange={setPersist}
          onSlugChange={setSlug}
        />
        <button type="button" class="primary share-button" disabled={sharing()} onClick={() => setChoosing(true)}>
          {sharing() ? "共有中..." : "Share"}
        </button>
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
        <Show when={!artifacts.loading} fallback={<p class="hint">読み込み中...</p>}>
          <Show when={(artifacts() ?? []).length > 0} fallback={<p class="empty-state">まだ共有されたものはありません</p>}>
            <ul class="artifact-list">
              <For each={artifacts()}>
                {(a) => (
                  <li>
                    <a href={`/artifact/${a.id}`} class="artifact-link">
                      <span class="artifact-filename">{a.title || a.filename}</span>
                      <span class="badge">
                        {a.mime} · {visibilityLabel(a.visibility)}
                        {a.persist ? " · 永続" : ""}
                      </span>
                    </a>
                    <div class="item-menu" classList={{ open: menuOpenId() === a.id }}>
                      <button
                        type="button"
                        class="ghost menu-trigger"
                        aria-label="操作メニュー"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId((cur) => (cur === a.id ? null : a.id));
                        }}
                      >
                        ⋯
                      </button>
                      <div class="menu-popover" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(a);
                            setMenuOpenId(null);
                          }}
                        >
                          編集
                        </button>
                        <div class="menu-settings-row">
                          <OptionsMenu
                            visibility={a.visibility}
                            persist={a.persist}
                            slug=""
                            showSlug={false}
                            onVisibilityChange={(v) => handleSettingsChange(a, { visibility: v })}
                            onPersistChange={(p) => handleSettingsChange(a, { persist: p })}
                            onSlugChange={() => {}}
                          />
                        </div>
                        <button type="button" class="danger" onClick={() => handleDelete(a.id)}>
                          削除
                        </button>
                      </div>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>

      <Show when={choosing()}>
        <div class="modal-backdrop" onClick={() => setChoosing(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>共有する内容を選択</h2>
            <div class="modal-actions">
              <button type="button" class="secondary" onClick={fromClipboard}>
                📋 From Clipboard
              </button>
              <button type="button" class="secondary" onClick={fromFile}>
                📎 From File
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={dropFile()}>
        {(file) => (
          <div class="modal-backdrop" onClick={() => setDropFile(null)}>
            <div class="modal" onClick={(e) => e.stopPropagation()}>
              <h2>"{file().name}" を共有しますか?</h2>
              <div class="modal-actions">
                <button type="button" class="primary" onClick={async () => submit(await file().text(), file().name)}>
                  Share!
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={editing()}>
        {(a) => (
          <EditModal
            artifact={a()}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await refetch();
            }}
          />
        )}
      </Show>
    </div>
  );
};

export default Home;
