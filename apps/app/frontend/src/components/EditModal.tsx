import { createResource, createSignal, Show, type Component } from "solid-js";
import { type ArtifactMeta, getArtifactRaw, updateArtifact } from "../lib/api";

export interface EditModalProps {
  artifact: ArtifactMeta;
  onClose: () => void;
  onSaved: () => void;
}

const EditModal: Component<EditModalProps> = (props) => {
  const [raw] = createResource(() => props.artifact.id, (id) => getArtifactRaw(id));
  const [content, setContent] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function save() {
    const value = content();
    if (value == null) return;
    setSaving(true);
    setError(null);
    try {
      await updateArtifact(props.artifact.id, { content: value });
      props.onSaved();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal edit-modal" onClick={(e) => e.stopPropagation()}>
        <h2>編集: {props.artifact.filename}</h2>
        <Show when={!raw.loading} fallback={<p class="hint">読み込み中...</p>}>
          <textarea
            class="edit-textarea"
            rows={16}
            value={content() ?? raw()?.content ?? ""}
            onInput={(e) => setContent(e.currentTarget.value)}
          />
        </Show>
        <Show when={error()}>
          <p class="error">{error()}</p>
        </Show>
        <div class="modal-actions">
          <button type="button" class="secondary" onClick={props.onClose}>
            キャンセル
          </button>
          <button type="button" class="primary" disabled={saving() || raw.loading} onClick={save}>
            {saving() ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditModal;
