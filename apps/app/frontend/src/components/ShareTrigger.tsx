import { createSignal, onCleanup, Show, type Component } from "solid-js";
import Spinner from "./Spinner";

export interface ShareTriggerProps {
  sharing: boolean;
  onClipboard: () => void;
  onFile: () => void;
}

const ShareTrigger: Component<ShareTriggerProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  function onDocumentClick(e: MouseEvent) {
    if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
  }
  document.addEventListener("click", onDocumentClick);
  onCleanup(() => document.removeEventListener("click", onDocumentClick));

  return (
    <div class="share-trigger" ref={rootRef}>
      <button
        type="button"
        class="primary share-button"
        disabled={props.sharing}
        onClick={() => setOpen((v) => !v)}
      >
        <Show when={props.sharing} fallback="Share">
          <Spinner label="共有中..." />
        </Show>
      </button>
      <div class="share-popover" classList={{ open: open() }}>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            props.onClipboard();
          }}
        >
          クリップボードから
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            props.onFile();
          }}
        >
          ファイルから
        </button>
      </div>
    </div>
  );
};

export default ShareTrigger;
