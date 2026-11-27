const shelf = document.getElementById("shelf");
const empty = document.getElementById("empty");
const player = document.getElementById("player");
const theater = document.getElementById("theater");
const nowTitle = document.getElementById("now-title");
const playFirst = document.getElementById("play-first");
const fileInput = document.getElementById("file-input");
const toast = document.getElementById("toast");
const originEl = document.getElementById("origin");

originEl.textContent = window.location.host;

let library = [];
let toastTimer = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function renderShelf(activeId = null) {
  shelf.innerHTML = "";
  empty.hidden = library.length > 0;

  for (const item of library) {
    const li = document.createElement("li");

    const meta = document.createElement("div");
    meta.className = "item-meta";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = item.title;

    const sub = document.createElement("p");
    sub.className = "item-sub";
    sub.textContent = `${formatBytes(item.size)} · ${item.mime.replace("video/", "")}`;

    meta.append(title, sub);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "item-play";
    button.textContent = "Play";
    button.setAttribute("aria-current", item.id === activeId ? "true" : "false");
    button.addEventListener("click", () => playItem(item));

    li.append(meta, button);
    shelf.append(li);
  }
}

function playItem(item) {
  theater.hidden = false;
  document.body.classList.add("is-playing");
  nowTitle.textContent = item.title;
  if (player.src !== new URL(item.url, window.location.origin).href) {
    player.src = item.url;
  }
  player.play().catch(() => {
    showToast("Press play on the video controls to start.");
  });
  renderShelf(item.id);
  requestAnimationFrame(() => {
    const top = Math.max(0, theater.getBoundingClientRect().top + window.scrollY - 24);
    window.scrollTo({ top, behavior: "smooth" });
  });
}

async function loadLibrary() {
  const res = await fetch("/api/library");
  if (!res.ok) throw new Error("Could not load library");
  const data = await res.json();
  library = data.items || [];
  renderShelf();
  return library;
}

playFirst.addEventListener("click", async () => {
  if (!library.length) {
    await loadLibrary();
  }
  if (!library.length) {
    showToast("Add a video first.");
    return;
  }
  const preferred =
    library.find((item) => /demo|sample|bunny/i.test(item.name)) ||
    library[0];
  playItem(preferred);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const body = new FormData();
  body.append("file", file, file.name);

  showToast(`Uploading ${file.name}…`);
  try {
    const res = await fetch("/api/upload", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    library = data.items || [];
    renderShelf();
    const added = library.find((item) => item.name === data.name) || library[0];
    if (added) playItem(added);
    showToast("Ready to stream.");
  } catch (err) {
    showToast(err.message || "Upload failed");
  } finally {
    fileInput.value = "";
  }
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
});

document.addEventListener("drop", async (event) => {
  event.preventDefault();
  const file = [...(event.dataTransfer?.files || [])].find((f) =>
    f.type.startsWith("video/")
  );
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change"));
});

try {
  await loadLibrary();
} catch (err) {
  showToast(err.message || "Library unavailable");
}
