import type { Component } from "solid-js";

const GuideModal: Component<{ onClose: () => void }> = (props) => (
  <div class="modal-backdrop" onClick={props.onClose}>
    <div class="modal guide-modal" onClick={(e) => e.stopPropagation()}>
      <h2>使い方</h2>
      <ul class="guide-list">
        <li>「Share」を押し、クリップボードかファイルを選ぶと内容を受け取り次第すぐに共有されます。</li>
        <li>Shareの下の⚙アイコンから、公開設定・永続化・カスタムURLを事前に変更できます。</li>
        <li>ファイルはこのページのどこにドラッグ&ドロップしても共有できます。</li>
        <li>一覧の「⋯」から内容の編集や、公開設定/永続化/種別の変更、削除ができます。</li>
        <li>永続化をオフのままにすると、90日後に自動的に削除されます。</li>
      </ul>
      <div class="modal-actions">
        <button type="button" class="secondary" onClick={props.onClose}>
          閉じる
        </button>
      </div>
    </div>
  </div>
);

export default GuideModal;
