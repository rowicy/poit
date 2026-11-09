import {
  createSignal,
  createEffect,
  createMemo,
  createResource,
  lazy,
  For,
  Show,
  onCleanup,
  type Component,
} from "solid-js";
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
// Same module the Worker validates with (apps/app/src/binary.ts), imported
// directly so the client-side guard can never drift from the server's 400.
import { isBinaryContent } from "../../../src/binary";
import { copyToClipboard } from "../lib/clipboard";
import OptionsMenu from "../components/OptionsMenu";
import ShareTrigger from "../components/ShareTrigger";
import Spinner from "../components/Spinner";
import ArtifactRow from "../components/ArtifactRow";
import FilterMenu, { type ArtifactFilters } from "../components/FilterMenu";

type Status = { kind: "error" | "success"; message: string; url?: string } | null;

// Keep in sync with apps/app/src/index.ts's SLUG_PATTERN and
// cli/poit/cmd/share.go's slugPattern.
const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

// The tour spotlights real DOM, so it ships its own JS and CSS; keep it out
// of the initial bundle and fetch that chunk only when 使い方 is clicked.
const GuideTour = lazy(() => import("../components/GuideTour"));

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

  const [sharing, setSharing] = createSignal(false);
  const [status, setStatus] = createSignal<Status>(null);
  const [guideOpen, setGuideOpen] = createSignal(false);

  const [filters, setFilters] = createSignal<ArtifactFilters>({ mime: "all", visibility: "all", persist: "all" });
  const filteredArtifacts = createMemo(() => {
    const f = filters();
    return store.artifacts.filter((a) => {
      if (f.mime !== "all" && a.mime !== f.mime) return false;
      if (f.visibility !== "all" && a.visibility !== f.visibility) return false;
      if (f.persist === "persist" && !a.persist) return false;
      if (f.persist === "temporary" && a.persist) return false;
      return true;
    });
  });
  const filtersActive = () => filters().mime !== "all" || filters().visibility !== "all" || filters().persist !== "all";

  let fileInputRef: HTMLInputElement | undefined;

  async function submit(content: string, filename?: string) {
    if (!content.trim()) {
      setStatus({ kind: "error", message: "内容が空です" });
      return;
    }
    // Covers both entry points at once: the file picker (where accept= only
    // nudges, it does not block) and the clipboard. The API re-checks this
    // and answers 400 - this is just the faster, localized message.
    if (isBinaryContent(content)) {
      setStatus({
        kind: "error",
        message: "テキストファイル(txt/md/htmlなど)のみ共有できます。バイナリファイルは共有できません",
      });
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

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
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

  return (
    <div class="home">
      <header class="site-header">
        <a href="/" class="brand">
          poit
        </a>
        <div class="header-actions">
          <button type="button" class="ghost guide-link" onClick={() => setGuideOpen(true)}>
            使い方
          </button>
          <a
            class="icon-link"
            href="https://github.com/rowicy/poit"
            target="_blank"
            rel="noopener"
            aria-label="GitHubリポジトリ"
            title="GitHubリポジトリ"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </div>
      </header>

      <input type="file" accept="text/*,.md,.markdown,.txt,.html,.htm" ref={fileInputRef} hidden onChange={onFileChosen} />

      <section class="share-field">
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
        <div class="artifact-list-header">
          <h2>アップロード済みアーティファクト</h2>
          <Show when={store.artifacts.length > 0}>
            <FilterMenu filters={filters()} onChange={setFilters} />
          </Show>
        </div>
        <Show when={!initial.loading} fallback={<Spinner label="読み込み中..." />}>
          <Show when={store.artifacts.length > 0} fallback={<p class="empty-state">まだ共有されたものはありません</p>}>
            <Show
              when={filteredArtifacts().length > 0}
              fallback={
                <p class="empty-state">
                  条件に一致するアーティファクトはありません。
                  <Show when={filtersActive()}>
                    {" "}
                    <button
                      type="button"
                      class="ghost filter-clear-inline"
                      onClick={() => setFilters({ mime: "all", visibility: "all", persist: "all" })}
                    >
                      フィルターを解除
                    </button>
                  </Show>
                </p>
              }
            >
              <ul class="artifact-list">
                <For each={filteredArtifacts()}>
                  {(a) => (
                    <ArtifactRow artifact={a} onDelete={handleDelete} onSettingsChange={handleSettingsChange} />
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </section>

      <Show when={guideOpen()}>
        <GuideTour onClose={() => setGuideOpen(false)} />
      </Show>
    </div>
  );
};

export default Home;
