import { createResource, createSignal, createMemo, lazy, Show, For, Suspense, onCleanup, type Component } from "solid-js";
import { getArtifactRaw } from "../lib/api";

// solid-markdown-wasm's WASM binary is very large (it bundles mermaid,
// katex, and syntax-highlighting themes we don't use) - loaded only when an
// artifact actually turns out to be Markdown, never for html/txt views.
const MarkdownRenderer = lazy(() =>
  import("solid-markdown-wasm").then((m) => ({ default: m.MarkdownRenderer }))
);

interface HeadingInfo {
  level: number;
  text: string;
  slideIndex: number;
}

function parseMarkdownStructure(markdown: string): { slideTexts: string[]; headings: HeadingInfo[] } {
  const lines = markdown.split(/\r?\n/);
  const slides: string[][] = [[]];
  const headings: HeadingInfo[] = [];

  for (const line of lines) {
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1 && slides[slides.length - 1].length > 0) {
        slides.push([]);
      }
      headings.push({ level, text: heading[2].trim(), slideIndex: slides.length - 1 });
    }
    slides[slides.length - 1].push(line);
  }

  return { slideTexts: slides.map((s) => s.join("\n")), headings };
}

const AUTO_HIDE_THRESHOLD_PX = 72;

const ArtifactPage: Component<{ id: string }> = (props) => {
  const [data] = createResource(() => props.id, (id) => getArtifactRaw(id));

  const [menuVisible, setMenuVisible] = createSignal(true);
  const [tocOpen, setTocOpen] = createSignal(false);
  const [slideMode, setSlideMode] = createSignal(false);
  const [slideIndex, setSlideIndex] = createSignal(0);
  let contentRef: HTMLDivElement | undefined;
  let headingEls: HTMLElement[] = [];

  function onMouseMove(e: MouseEvent) {
    setMenuVisible(e.clientY < AUTO_HIDE_THRESHOLD_PX);
  }
  document.addEventListener("mousemove", onMouseMove);
  onCleanup(() => document.removeEventListener("mousemove", onMouseMove));

  const structure = createMemo(() => {
    const d = data();
    if (!d || d.artifact.mime !== "md") return null;
    return parseMarkdownStructure(d.content);
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

  function jumpToHeading(index: number) {
    const heading = structure()?.headings[index];
    if (!heading) return;
    if (slideMode()) {
      setSlideIndex(heading.slideIndex);
      setTocOpen(false);
      return;
    }
    headingEls[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTocOpen(false);
  }

  const currentMarkdown = createMemo(() => {
    const s = structure();
    if (!s) return "";
    return slideMode() ? s.slideTexts[slideIndex()] ?? "" : (data()?.content ?? "");
  });

  return (
    <Show when={!data.loading} fallback={<p class="hint">読み込み中...</p>}>
      <Show
        when={!data.error}
        fallback={<p class="error">{data.error ? String(data.error.message ?? data.error) : "エラー"}</p>}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setTocOpen((v) => !v);
                  }}
                >
                  ☰ 目次
                </button>
                <span class="md-menubar-title">{artifact.title || artifact.filename}</span>
                <label class="md-slide-toggle" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={slideMode()}
                    onChange={(e) => {
                      setSlideIndex(0);
                      setSlideMode(e.currentTarget.checked);
                    }}
                  />
                  スライドモード
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

              <div class="md-content" ref={contentRef}>
                <Suspense fallback={<p class="hint">読み込み中...</p>}>
                  <MarkdownRenderer
                    markdown={currentMarkdown()}
                    theme="nord"
                    onLoaded={collectHeadings}
                    fallback={<p class="hint">レンダリング中...</p>}
                  />
                </Suspense>
              </div>
            </div>
          );
        })()}
      </Show>
    </Show>
  );
};

export default ArtifactPage;
