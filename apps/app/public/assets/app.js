const app = document.getElementById("app");

const DLP_PATTERNS = [
  { name: "GitHub トークン", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitLab トークン", re: /glpat-[A-Za-z0-9\-_]{20,}/ },
  { name: "Bearer トークン", re: /Bearer\s+[A-Za-z0-9\-_.]{10,}/i },
  { name: "クレジットカード番号", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/ },
  { name: "電話番号", re: /\b0\d{1,4}-?\d{1,4}-?\d{3,4}\b/ },
];

function findSecrets(text) {
  return DLP_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

async function api(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts?.headers ?? {}) },
  });
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
  } catch {
    // clipboard API unavailable (e.g. insecure context) - ignore silently
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

async function renderHome() {
  app.replaceChildren(el("p", { textContent: "読み込み中..." }));

  let artifacts;
  try {
    ({ artifacts } = await api("/api/v1/artifacts"));
  } catch (err) {
    app.replaceChildren(el("p", { className: "error", textContent: String(err.message ?? err) }));
    return;
  }

  const contentInput = el("textarea", { placeholder: "テキストをペースト、またはファイルを選択", rows: 10 });
  const fileInput = el("input", { type: "file" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) contentInput.value = await readFileAsText(file);
  });

  const visibilitySelect = el("select", {}, [
    el("option", { value: "private", textContent: "プライベート (rowicy内)" }),
    el("option", { value: "public", textContent: "パブリック" }),
  ]);
  const persistCheckbox = el("input", { type: "checkbox" });

  const shareButton = el("button", { textContent: "共有する" });
  const status = el("p", { className: "status" });

  shareButton.addEventListener("click", async () => {
    const content = contentInput.value;
    if (!content.trim()) {
      status.textContent = "内容を入力してください";
      return;
    }

    const hits = findSecrets(content);
    if (hits.length > 0) {
      const proceed = confirm(
        `機密情報の可能性がある文字列が見つかりました: ${hits.join(", ")}\nこのまま共有しますか?`
      );
      if (!proceed) return;
    }

    try {
      const { url } = await api("/api/v1/artifact", {
        method: "POST",
        body: JSON.stringify({
          content,
          filename: fileInput.files?.[0]?.name,
          visibility: visibilitySelect.value,
          persist: persistCheckbox.checked,
        }),
      });
      await copyToClipboard(url);
      status.innerHTML = "";
      status.append(
        "共有URLをコピーしました: ",
        el("a", { href: url, textContent: url })
      );
      await renderHome();
    } catch (err) {
      status.textContent = String(err.message ?? err);
    }
  });

  const form = el("section", { className: "post-form" }, [
    el("h2", { textContent: "アップロード" }),
    contentInput,
    fileInput,
    el("label", {}, [visibilitySelect]),
    el("label", {}, [persistCheckbox, document.createTextNode(" 永続化する")]),
    shareButton,
    status,
  ]);

  const list = el(
    "ul",
    { className: "artifact-list" },
    artifacts.map((a) =>
      el("li", {}, [
        el("a", {
          href: `/artifact/${a.id}`,
          textContent: `${a.filename} (${a.mime}, ${a.visibility}${a.persist ? ", 永続" : ""})`,
        }),
      ])
    )
  );

  app.replaceChildren(
    form,
    el("section", {}, [el("h2", { textContent: "アップロード済みアーティファクト" }), list])
  );
}

async function renderArtifact(id) {
  app.replaceChildren(el("p", { textContent: "読み込み中..." }));

  let artifact, content;
  try {
    ({ artifact, content } = await api(`/artifact/${id}/raw`));
  } catch (err) {
    app.replaceChildren(el("p", { className: "error", textContent: String(err.message ?? err) }));
    return;
  }

  let rendered;
  if (artifact.mime === "md") {
    rendered = el("div", { className: "rendered-md", innerHTML: marked.parse(content) });
  } else if (artifact.mime === "html") {
    rendered = el("iframe", {
      className: "rendered-html",
      sandbox: "allow-scripts",
      srcdoc: content,
    });
  } else {
    rendered = el("pre", { className: "rendered-txt", textContent: content });
  }

  app.replaceChildren(rendered);
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
