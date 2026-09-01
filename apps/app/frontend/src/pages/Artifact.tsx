import { createResource, createSignal, createMemo, createEffect, Show, For, onCleanup, type Component } from "solid-js";
import { ApiError, getArtifactJson } from "../lib/api";
import Spinner from "../components/Spinner";
import type * as MarkdownLib from "../lib/markdown";

const AUTO_HIDE_THRESHOLD_PX = 72;

const ArtifactPage: Component<{ id: string }> = (props) => {
  const [data] = createResource(() => props.id, (id) => getArtifactJson(id));

  const [menuVisible, setMenuVisible] = createSignal(true);
  const [tocOpen, setTocOpen] = createSignal(false);
  const [slideMode, setSlideMode] = createSignal(false);
  const [slideIndex, setSlideIndex] = createSignal(0);
  const [mdLib, setMdLib] = createSignal<typeof MarkdownLib | null>(null);
  let contentRef: HTMLDivElement | undefined;
  let headingEls: HTMLElement[] = [];

  function onMouseMove(e: MouseEvent) {
    setMenuVisible(e.clientY < AUTO_HIDE_THRESHOLD_PX);
  }
  document.addEventListener("mousemove", onMouseMove);
  onCleanup(() => document.removeEventListener("mousemove", onMouseMove));

  // markdown-it + highlight.js are loaded only once an artifact actually
  // turns out to be Markdown, never for html/txt views (this replaces
  // solid-markdown-wasm, whose WASM binary bundled mermaid/katex we never
  // used and rendering we couldn't fix - see ../lib/markdown.ts).
  createEffect(() => {
    if (data()?.artifact.mime === "md" && !mdLib()) {
      import("../lib/markdown").then(setMdLib);
    }
  });

  const structure = createMemo(() => {
    // data() throws when the resource has errored (e.g. 404); guard on
    // data.error first so that doesn't crash this memo's reactive graph.
    if (data.error) return null;
    const d = data();
    const lib = mdLib();
    if (!d || !lib || d.artifact.mime !== "md") return null;
    return lib.parseMarkdownStructure(d.content);
  });

  const slideCount = () => structure()?.slideTexts.length ?? 0;

  function nextSlide() {
    setSlideIndex((i) => Math.min(i + 1, slideCount() - 1));
  }
  function prevSlide() {
    setSlideIndex((i) => Math.max(i - 1, 0));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!slideMode()) return;
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
      e.preventDefault();
      nextSlide();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      prevSlide();
    }
  }
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  function onContentClick(e: MouseEvent) {
    if (!slideMode()) return;
    if ((e.target as HTMLElement).closest("a")) return; // don't hijack link clicks
    const half = window.innerWidth / 2;
    if (e.clientX > half) nextSlide();
    else prevSlide();
  }

  function collectHeadings() {
    if (!contentRef) return;
    headingEls = Array.from(contentRef.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  }

  // Panel open/close is controlled only by the ☰ toggle button - jumping to
  // a heading must not also close it (previously did, via setTocOpen(false)
  // below).
  function jumpToHeading(index: number) {
    const heading = structure()?.headings[index];
    if (!heading) return;
    if (slideMode()) {
      setSlideIndex(heading.slideIndex);
      return;
    }
    headingEls[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const currentMarkdown = createMemo(() => {
    const s = structure();
    if (!s) return "";
    return slideMode() ? s.slideTexts[slideIndex()] ?? "" : (data()?.content ?? "");
  });

  // Frontmatter isn't part of the rendered body (renderMarkdown strips it) -
  // shown instead as a property list above the content, only for the full
  // document (a slide's raw text never contains the leading `---` block).
  const frontmatter = createMemo(() => {
    const d = data();
    const lib = mdLib();
    if (!d || !lib || d.artifact.mime !== "md") return [];
    return lib.parseFrontmatter(d.content);
  });

  // Renders into contentRef imperatively (rather than via a reactive
  // innerHTML prop) so collectHeadings/renderMermaidDiagrams run in the same
  // tick, right after the markup they inspect actually lands in the DOM.
  createEffect(() => {
    const lib = mdLib();
    const markdown = currentMarkdown();
    if (!lib || !contentRef) return;
    contentRef.innerHTML = lib.renderMarkdown(markdown);
    collectHeadings();
    void lib.renderMermaidDiagrams(contentRef);
  });

  return (
    <Show when={!data.loading} fallback={<Spinner label="読み込み中..." />}>
      <Show
        when={!data.error}
        fallback={
          <div class="artifact-not-found">
            <Show
              when={data.error instanceof ApiError && data.error.status === 404}
              fallback={<p class="error">{String(data.error?.message ?? data.error)}</p>}
            >
              <p class="error">このアーティファクトは見つかりません。削除されたか、URLが間違っている可能性があります。</p>
            </Show>
          </div>
        }
      >
        {(() => {
          const artifact = data()!.artifact;
          const content = data()!.content;

          if (artifact.mime === "html") {
            return <iframe class="rendered-html" sandbox="allow-scripts" srcdoc={content} />;
          }

          if (artifact.mime === "txt") {
            return <pre class="rendered-txt">{content}</pre>;
          }

          // Markdown: nord theme, auto-hiding top bar, optional slide mode + TOC.
          return (
            <div class="md-viewer nord" classList={{ "slide-mode": slideMode() }} onClick={onContentClick}>
              <div class="md-menubar" classList={{ visible: menuVisible() || tocOpen() }}>
                <button
                  type="button"
                  class="ghost"
                  aria-label="目次"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTocOpen((v) => !v);
                  }}
                >
                  ☰ <span class="md-menubar-label">目次</span>
                </button>
                <span class="md-menubar-title">{artifact.title || artifact.filename}</span>
                <label class="md-slide-toggle" title="スライドモード" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={slideMode()}
                    onChange={(e) => {
                      setSlideIndex(0);
                      setSlideMode(e.currentTarget.checked);
                    }}
                  />
                  <span class="md-menubar-label">スライドモード</span>
                </label>
                <Show when={slideMode()}>
                  <span class="hint">
                    {slideIndex() + 1} / {slideCount()}
                  </span>
                </Show>
              </div>

              <div class="md-toc-panel" classList={{ open: tocOpen() }} onClick={(e) => e.stopPropagation()}>
                <div class="md-toc-title">目次</div>
                <ul>
                  <For each={structure()?.headings}>
                    {(h, i) => (
                      <li classList={{ [`toc-level-${h.level}`]: true }}>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            jumpToHeading(i());
                          }}
                        >
                          {h.text}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </div>

              <Show when={mdLib()} fallback={<div class="md-content"><Spinner label="読み込み中..." /></div>}>
                <div class="md-content">
                  <Show when={!slideMode() && frontmatter().length > 0}>
                    <div class="md-frontmatter">
                      <For each={frontmatter()}>
                        {(prop) => (
                          <div class="md-frontmatter-row">
                            <span class="md-frontmatter-key">{prop.key}</span>
                            <span class="md-frontmatter-values">
                              <For each={prop.values}>{(v) => <span class="md-frontmatter-chip">{v}</span>}</For>
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div ref={contentRef} />
                </div>
              </Show>
            </div>
          );
        })()}
      </Show>
    </Show>
  );
};

export default ArtifactPage;
