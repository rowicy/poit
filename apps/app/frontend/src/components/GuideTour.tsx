import { createSignal, createEffect, onCleanup, Show, type Component, type JSX } from "solid-js";
// This module (and its CSS) is a separate async chunk fetched only when the
// 使い方 button is clicked - see pages/Home.tsx's lazy().
import "./guide-tour.css";

type Step = {
  /** Selector of the element to spotlight; null = no target, centered card. */
  target: string | null;
  title: string;
  body: () => JSX.Element;
};

// These selectors couple the tour to other components' class names - the one
// thing here that breaks silently, so rename a target's class and fix it here
// too. FilterMenu's root carries both "options-menu" and "filter-menu", so
// the share options gear has to be scoped to .share-stack to not match it.
// A step whose target isn't on the page (e.g. the list rows while the list is
// empty) falls back to a centered card over a plain dim - see holeStyle().
const STEPS: Step[] = [
  {
    target: ".share-trigger",
    title: "共有する",
    body: () => <>「Share」を押し、クリップボードかファイルを選ぶと、内容を受け取り次第すぐに共有されます。共有URLは自動でコピーされます。</>,
  },
  {
    target: ".share-stack .options-menu",
    title: "共有前に設定する",
    body: () => (
      <>
        Shareの下の⚙から、公開設定・永続化・カスタムURLを事前に変更できます。永続化をオフのままにすると、90日後に自動的に削除されます。
      </>
    ),
  },
  {
    target: ".artifact-list-card",
    title: "一覧を見る",
    body: () => <>共有したものはここに並びます。行をクリックすると内容を表示できます。</>,
  },
  {
    target: ".artifact-list .menu-trigger",
    title: "あとから変更する",
    body: () => <>各行の「⋯」から、公開設定・永続化・種別の変更と、削除ができます。</>,
  },
  {
    target: ".filter-menu",
    title: "絞り込む",
    body: () => <>「絞り込み」から、種別・公開設定・永続化でアーティファクトを絞り込めます。</>,
  },
  {
    target: null,
    title: "curlやLLMから読み込む",
    body: () => (
      <>
        公開設定にしたうえで、共有URLの末尾に <code>/raw</code> を付けると、装飾のない生テキストが返ります。curlやLLMに読み込ませたいときはこちらを使ってください。
        <span class="guide-url">
          https://poit.rowicy.com/artifact/e25e5e84-7e7a-43c6-8c8a-cc4d01878b1a<span class="guide-url-raw">/raw</span>
        </span>
        <span class="guide-note">非公開のままだと、ログインしていないcurlやLLMからは読み取れません。</span>
      </>
    ),
  },
];

/** Keep in sync with .guide-pop's max-width. */
const POPOVER_WIDTH_PX = 352;
const EDGE_MARGIN_PX = 16;
const GAP_PX = 12;
/** Below this much free space on one side, the popover goes on the other. */
const MIN_SIDE_SPACE_PX = 220;

const GuideTour: Component<{ onClose: () => void }> = (props) => {
  const [index, setIndex] = createSignal(0);
  const [rect, setRect] = createSignal<DOMRect | null>(null);

  const step = () => STEPS[index()];

  function measure() {
    const selector = step().target;
    const el = selector ? document.querySelector(selector) : null;
    setRect(el ? el.getBoundingClientRect() : null);
  }

  createEffect(() => {
    const selector = step().target;
    const el = selector ? document.querySelector(selector) : null;
    // Instant, not smooth: the spotlight hole animates between steps via CSS,
    // and a smooth scroll would leave the measured rect chasing it.
    el?.scrollIntoView({ block: "center", behavior: "auto" });
    measure();
  });

  // Capture phase so scrolling any ancestor (not just the window) re-measures.
  window.addEventListener("scroll", measure, true);
  window.addEventListener("resize", measure);
  onCleanup(() => {
    window.removeEventListener("scroll", measure, true);
    window.removeEventListener("resize", measure);
  });

  const holeStyle = (): JSX.CSSProperties | undefined => {
    const r = rect();
    if (!r) return undefined;
    return {
      top: `${r.top - 6}px`,
      left: `${r.left - 6}px`,
      width: `${r.width + 12}px`,
      height: `${r.height + 12}px`,
    };
  };

  // Anchors by top when there's room below the target, otherwise by bottom
  // above it - which means the popover's own height never has to be measured.
  const popStyle = (): JSX.CSSProperties => {
    const width = Math.min(POPOVER_WIDTH_PX, window.innerWidth - EDGE_MARGIN_PX * 2);
    const r = rect();
    if (!r) return { width: `${width}px`, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
    const left = Math.min(
      Math.max(EDGE_MARGIN_PX, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - EDGE_MARGIN_PX
    );
    const base = { width: `${width}px`, left: `${left}px` };
    if (window.innerHeight - r.bottom >= MIN_SIDE_SPACE_PX) return { ...base, top: `${r.bottom + GAP_PX}px` };
    if (r.top >= MIN_SIDE_SPACE_PX) return { ...base, bottom: `${window.innerHeight - r.top + GAP_PX}px` };
    return { ...base, bottom: `${EDGE_MARGIN_PX}px` };
  };

  const isLast = () => index() === STEPS.length - 1;

  return (
    <div class="guide-tour" onClick={props.onClose}>
      <Show when={holeStyle()} fallback={<div class="guide-dim" />}>
        {(style) => <div class="guide-hole" style={style()} />}
      </Show>
      <div class="guide-pop" style={popStyle()} onClick={(e) => e.stopPropagation()}>
        <p class="guide-count">
          {index() + 1} / {STEPS.length}
        </p>
        <h2>{step().title}</h2>
        <p class="guide-body">{step().body()}</p>
        <div class="guide-nav">
          <button type="button" class="ghost" onClick={props.onClose}>
            閉じる
          </button>
          <div class="guide-nav-spacer" />
          <Show when={index() > 0}>
            <button type="button" class="secondary" onClick={() => setIndex((i) => i - 1)}>
              戻る
            </button>
          </Show>
          <button type="button" class="primary" onClick={() => (isLast() ? props.onClose() : setIndex((i) => i + 1))}>
            <Show when={isLast()} fallback="次へ">
              完了
            </Show>
          </button>
        </div>
      </div>
    </div>
  );
};

export default GuideTour;
