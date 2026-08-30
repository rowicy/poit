// Client-side use of the real Go-WASM build of
// github.com/riiimparm/is-md-or-html-or-text, for instant "detected as..."
// feedback right after content is captured (clipboard/file/drop) - purely
// cosmetic. The Worker stores its own authoritative detection (a
// hand-synced TypeScript port, see apps/app/src/mime.ts) since Cloudflare
// disallows compiling WebAssembly from raw bytes at request time; browsers
// have no such restriction, so the real WASM module is used here.

export type ArtifactMime = "md" | "html" | "txt";

declare global {
  interface Window {
    Go?: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
    filekindDetect?: (content: string) => string;
  }
}

let ready: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(script);
  });
}

function init(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await loadScript("/wasm/wasm_exec.js");
      const go = new window.Go!();
      const res = await fetch("/wasm/filekind.wasm");
      const bytes = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
      go.run(instance).catch(() => {
        /* program never exits by design */
      });
    })();
  }
  return ready;
}

function toArtifactMime(kind: string | undefined): ArtifactMime {
  if (kind === "html") return "html";
  if (kind === "markdown") return "md";
  return "txt";
}

export async function detectMime(content: string): Promise<ArtifactMime> {
  await init();
  return toArtifactMime(window.filekindDetect?.(content));
}
