const app = document.getElementById("app");

const DLP_PATTERNS = [
  { name: "GitHub トークン", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitLab トークン", re: /glpat-[A-Za-z0-9\-_]{20,}/ },
  { name: "Bearer トークン", re: /Bearer\s+[A-Za-z0-9\-_.]{10,}/i },
  { name: "クレジットカード番号", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/ },
  { name: "電話番号", re: /\b0\d{1,4}-?\d{1,4}-?\d{3,4}\b/ },
];

const SLUG_PATTERN = /^[A-Z0-9_-]{1,64}$/;

function findSecrets(text) {
  return DLP_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

async function api(path, opts) {
  let res;
  try {
    res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts?.headers ?? {}) },
    });
  } catch {
    throw new Error("通信に失敗しました。ネットワーク接続を確認してください。");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const loadedScripts = new Map();
function loadScript(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = el("script", { src });
    script.onload = resolve;
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

function header() {
  return el("header", { className: "site-header" }, [
    el("a", { href: "/", className: "brand", textContent: "poit" }),
  ]);
}

function visibilityLabel(visibility) {
  return visibility === "public" ? "公開" : "非公開";
}

async function renderHome() {
  let artifacts;
  try {
    ({ artifacts } = await api("/api/v1/artifacts"));
  } catch (err) {
    app.replaceChildren(header(), el("p", { className: "error", textContent: String(err.message ?? err) }));
    return;
  }

  const contentInput = el("textarea", {
    className: "content-input",
    placeholder: "ここにテキストをペースト、またはファイルをドラッグ&ドロップ",
    rows: 10,
  });
  const fileInput = el("input", { type: "file", id: "file-input", hidden: true });
  const fileNameLabel = el("span", { className: "file-name" });
  const slugInput = el("input", {
    type: "text",
    className: "slug-input",
    placeholder: "例: MY-DOC-1 (省略可)",
    pattern: "[A-Za-z0-9_-]*",
  });
  slugInput.addEventListener("input", () => {
    slugInput.value = slugInput.value.toUpperCase();
  });

  // Tracks the in-flight file read so the share handler can await it instead
  // of racing it - selecting a file and clicking "共有する" immediately used
  // to submit before readFileAsText() resolved, sending empty content.
  let pendingFileLoad = Promise.resolve();

  async function loadFile(file) {
    if (contentInput.value.trim() && !confirm(`入力中のテキストを "${file.name}" の内容で置き換えますか?`)) {
      return;
    }
    try {
      contentInput.value = await readFileAsText(file);
      fileNameLabel.textContent = file.name;
    } catch {
      fileNameLabel.textContent = "";
      status.replaceChildren(el("p", { className: "error", textContent: `${file.name} を読み込めませんでした` }));
    }
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) pendingFileLoad = loadFile(file);
  });

  const dropZone = el(
    "div",
    { className: "drop-zone" },
    [
      contentInput,
      el("div", { className: "drop-zone-actions" }, [
        el("label", { className: "file-picker", htmlFor: "file-input", title: "ファイルを選択" }, [
          document.createTextNode("📎"),
        ]),
        fileInput,
        fileNameLabel,
      ]),
    ]
  );
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) pendingFileLoad = loadFile(file);
  });

  const visibilitySelect = el("select", {}, [
    el("option", { value: "private", textContent: "プライベート (rowicy内)" }),
    el("option", { value: "public", textContent: "パブリック (誰でも閲覧可)" }),
  ]);
  const persistCheckbox = el("input", { type: "checkbox", id: "persist-checkbox" });

  const shareButton = el("button", { className: "primary", textContent: "共有する" });
  const status = el("div", { className: "status", role: "status" });

  async function refreshList() {
    const { artifacts } = await api("/api/v1/artifacts");
    list.replaceChildren(...renderListItems(artifacts));
  }

  shareButton.addEventListener("click", async () => {
    const slug = slugInput.value.trim();
    if (slug && !SLUG_PATTERN.test(slug)) {
      status.replaceChildren(
        el("p", { className: "error", textContent: "カスタムURLは英大文字/数字/-/_のみ使用できます" })
      );
      return;
    }

    shareButton.disabled = true;
    shareButton.textContent = "読み込み中...";
    await pendingFileLoad;

    const content = contentInput.value;
    if (!content.trim()) {
      status.replaceChildren(el("p", { className: "error", textContent: "内容を入力してください" }));
      shareButton.disabled = false;
      shareButton.textContent = "共有する";
      return;
    }

    const hits = findSecrets(content);
    if (hits.length > 0) {
      const proceed = confirm(
        `機密情報の可能性がある文字列が見つかりました: ${hits.join(", ")}\nこのまま共有しますか?`
      );
      if (!proceed) {
        shareButton.disabled = false;
        shareButton.textContent = "共有する";
        return;
      }
    }

    shareButton.textContent = "共有中...";
    try {
      const { url } = await api("/api/v1/artifact", {
        method: "POST",
        body: JSON.stringify({
          content,
          filename: fileInput.files?.[0]?.name,
          slug: slug || undefined,
          visibility: visibilitySelect.value,
          persist: persistCheckbox.checked,
        }),
      });

      const copied = await copyToClipboard(url);
      const link = el("a", { href: url, textContent: url, target: "_blank", rel: "noopener" });
      status.replaceChildren(
        el("div", { className: "share-result" }, [
          el("p", { textContent: copied ? "共有URLをコピーしました:" : "共有URLを作成しました(自動コピーには失敗しました。リンクを手動でコピーしてください):" }),
          link,
        ])
      );

      contentInput.value = "";
      fileInput.value = "";
      fileNameLabel.textContent = "";
      slugInput.value = "";
      await refreshList();
    } catch (err) {
      status.replaceChildren(el("p", { className: "error", textContent: String(err.message ?? err) }));
    } finally {
      shareButton.disabled = false;
      shareButton.textContent = "共有する";
    }
  });

  contentInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") shareButton.click();
  });

  const form = el("section", { className: "card post-form" }, [
    el("h2", { textContent: "アップロード" }),
    dropZone,
    el("div", { className: "form-row" }, [
      el("label", { className: "field" }, [
        el("span", { className: "field-label", textContent: "公開設定" }),
        visibilitySelect,
      ]),
      el("label", { className: "field" }, [
        el("span", { className: "field-label", textContent: "カスタムURL" }),
        slugInput,
      ]),
      el("label", { className: "field checkbox-field" }, [
        persistCheckbox,
        el("span", {}, [
          document.createTextNode(" 永続化する"),
          el("small", { className: "hint", textContent: "オフの場合は90日後に自動削除されます" }),
        ]),
      ]),
    ]),
    el("div", { className: "form-actions" }, [
      shareButton,
      el("small", { className: "hint", textContent: "Cmd/Ctrl + Enter でも共有できます" }),
    ]),
    status,
  ]);

  function closeAllMenus() {
    for (const menu of list.querySelectorAll(".item-menu.open")) menu.classList.remove("open");
  }
  document.addEventListener("click", closeAllMenus);

  async function startEdit(li, artifact) {
    li.replaceChildren(el("p", { className: "hint", textContent: "読み込み中..." }));
    let content;
    try {
      ({ content } = await api(`/artifact/${artifact.id}/raw`));
    } catch (err) {
      li.replaceChildren(el("p", { className: "error", textContent: String(err.message ?? err) }));
      return;
    }

    const editContent = el("textarea", { className: "content-input", value: content, rows: 6 });
    const editVisibility = el("select", {}, [
      el("option", { value: "private", textContent: "プライベート (rowicy内)", selected: artifact.visibility === "private" }),
      el("option", { value: "public", textContent: "パブリック (誰でも閲覧可)", selected: artifact.visibility === "public" }),
    ]);
    const editPersist = el("input", { type: "checkbox", checked: artifact.persist });
    const editStatus = el("p", { className: "error" });

    const saveButton = el("button", { className: "primary", textContent: "保存" });
    const cancelButton = el("button", { className: "secondary", textContent: "キャンセル" });

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      try {
        await api(`/api/v1/artifact/${artifact.id}`, {
          method: "PUT",
          body: JSON.stringify({
            content: editContent.value,
            visibility: editVisibility.value,
            persist: editPersist.checked,
          }),
        });
        await refreshList();
      } catch (err) {
        editStatus.textContent = String(err.message ?? err);
        saveButton.disabled = false;
      }
    });
    cancelButton.addEventListener("click", () => refreshList());

    li.replaceChildren(
      el("div", { className: "edit-form" }, [
        editContent,
        el("div", { className: "form-row" }, [
          el("label", { className: "field" }, [el("span", { className: "field-label", textContent: "公開設定" }), editVisibility]),
          el("label", { className: "field checkbox-field" }, [editPersist, document.createTextNode(" 永続化する")]),
        ]),
        el("div", { className: "form-actions" }, [saveButton, cancelButton]),
        editStatus,
      ])
    );
  }

  async function deleteArtifact(id) {
    if (!confirm("このアーティファクトを削除しますか? この操作は取り消せません。")) return;
    try {
      await api(`/api/v1/artifact/${id}`, { method: "DELETE" });
      await refreshList();
    } catch (err) {
      status.replaceChildren(el("p", { className: "error", textContent: String(err.message ?? err) }));
    }
  }

  function renderListItems(artifacts) {
    if (artifacts.length === 0) {
      return [el("p", { className: "empty-state", textContent: "まだ共有されたものはありません" })];
    }
    return artifacts.map((a) => {
      const menu = el("div", { className: "item-menu" }, [
        el("button", {
          className: "menu-trigger",
          textContent: "⋯",
          "aria-label": "操作メニュー",
          onclick: (e) => {
            e.stopPropagation();
            const wasOpen = menu.classList.contains("open");
            closeAllMenus();
            if (!wasOpen) menu.classList.add("open");
          },
        }),
        el("div", { className: "menu-popover" }, [
          el("button", { textContent: "編集", onclick: () => startEdit(li, a) }),
          el("button", { className: "danger", textContent: "削除", onclick: () => deleteArtifact(a.id) }),
        ]),
      ]);

      const li = el("li", {}, [
        el("a", { href: `/artifact/${a.id}`, className: "artifact-link" }, [
          el("span", { className: "artifact-filename", textContent: a.filename }),
          el("span", {
            className: "badge",
            textContent: `${a.mime} · ${visibilityLabel(a.visibility)}${a.persist ? " · 永続" : ""}`,
          }),
        ]),
        menu,
      ]);
      return li;
    });
  }

  const list = el("ul", { className: "artifact-list" }, renderListItems(artifacts));

  app.replaceChildren(
    header(),
    form,
    el("section", { className: "card" }, [el("h2", { textContent: "アップロード済みアーティファクト" }), list])
  );
}

async function renderArtifact(id) {
  app.replaceChildren(header(), el("p", { textContent: "読み込み中..." }));

  let artifact, content;
  try {
    ({ artifact, content } = await api(`/artifact/${id}/raw`));
  } catch (err) {
    app.replaceChildren(header(), el("p", { className: "error", textContent: String(err.message ?? err) }));
    return;
  }

  document.title = `${artifact.filename} - poit`;

  const rawMimeType = { md: "text/markdown", html: "text/html", txt: "text/plain" }[artifact.mime] ?? "text/plain";
  const rawBlobUrl = URL.createObjectURL(new Blob([content], { type: `${rawMimeType};charset=utf-8` }));
  const meta = el("div", { className: "artifact-meta" }, [
    el("span", { className: "artifact-filename", textContent: artifact.filename }),
    el("span", {
      className: "badge",
      textContent: `${artifact.mime} · ${visibilityLabel(artifact.visibility)}`,
    }),
    el("div", { className: "artifact-actions" }, [
      el("button", {
        className: "secondary",
        textContent: "コピー",
        onclick: async (e) => {
          const ok = await copyToClipboard(content);
          e.target.textContent = ok ? "コピーしました" : "コピーに失敗";
          setTimeout(() => (e.target.textContent = "コピー"), 1500);
        },
      }),
      el("a", {
        className: "secondary",
        href: rawBlobUrl,
        target: "_blank",
        rel: "noopener",
        textContent: "新しいタブで開く",
      }),
    ]),
  ]);

  let rendered;
  if (artifact.mime === "md") {
    rendered = el("div", { className: "rendered-md card" }, [el("p", { textContent: "レンダリング中..." })]);
    try {
      await Promise.all([
        loadScript("/assets/vendor/marked.umd.js"),
        loadScript("/assets/vendor/purify.min.js"),
      ]);
      const html = window.DOMPurify.sanitize(window.marked.parse(content));
      rendered.replaceChildren();
      rendered.innerHTML = html;
    } catch {
      rendered.replaceChildren(el("pre", { className: "rendered-txt", textContent: content }));
    }
  } else if (artifact.mime === "html") {
    rendered = el("iframe", {
      className: "rendered-html card",
      sandbox: "allow-scripts",
      srcdoc: content,
    });
  } else {
    rendered = el("pre", { className: "rendered-txt card", textContent: content });
  }

  app.replaceChildren(header(), meta, rendered);
}

function route() {
  const match = location.pathname.match(/^\/artifact\/([\w-]+)$/);
  if (match) {
    renderArtifact(match[1]);
  } else {
    renderHome();
  }
}

route();
