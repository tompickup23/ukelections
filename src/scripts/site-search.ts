interface SiteSearchEntry {
  href: string;
  title: string;
  kind: "page" | "region" | "place";
  kicker: string;
  description: string;
  priority: number;
  searchText: string;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatHint(): string {
  return navigator.userAgent.toLowerCase().includes("mac") ? "Cmd+K" : "Ctrl+K";
}

function scoreEntry(entry: SiteSearchEntry, query: string): number {
  const normalizedQuery = normalise(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return entry.priority;
  }

  const title = normalise(entry.title);
  const kicker = normalise(entry.kicker);
  const description = normalise(entry.description);
  const haystack = `${title} ${kicker} ${description} ${entry.searchText}`;

  if (!tokens.every((token) => haystack.includes(token))) {
    return -1;
  }

  let score = entry.priority;

  if (title.startsWith(normalizedQuery)) {
    score += 160;
  } else if (title.includes(normalizedQuery)) {
    score += 110;
  }

  if (kicker.includes(normalizedQuery)) {
    score += 40;
  }

  for (const token of tokens) {
    if (title.startsWith(token)) {
      score += 28;
    } else if (title.includes(token)) {
      score += 16;
    }

    if (entry.searchText.includes(token)) {
      score += 8;
    }
  }

  if (entry.kind === "page") {
    score += 14;
  } else if (entry.kind === "region") {
    score += 8;
  }

  return score;
}

let entriesPromise: Promise<SiteSearchEntry[]> | null = null;

function loadEntries(): Promise<SiteSearchEntry[]> {
  if (!entriesPromise) {
    entriesPromise = fetch("/search-index.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Search index request failed with ${response.status}`);
        }

        return response.json() as Promise<SiteSearchEntry[]>;
      })
      .then((entries) => entries.sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title)));
  }

  return entriesPromise;
}

export function initSiteSearch(): void {
  const root = document.querySelector<HTMLElement>("[data-site-search]");

  if (!root) {
    return;
  }

  const panel = root.querySelector<HTMLElement>("[data-site-search-panel]");
  const openButtons = Array.from(document.querySelectorAll<HTMLElement>("[data-site-search-open]"));
  const closeButtons = Array.from(root.querySelectorAll<HTMLElement>("[data-site-search-close]"));
  const input = root.querySelector<HTMLInputElement>("[data-site-search-input]");
  const status = root.querySelector<HTMLElement>("[data-site-search-status]");
  const results = root.querySelector<HTMLElement>("[data-site-search-results]");
  const hint = root.querySelector<HTMLElement>("[data-site-search-hint]");

  if (!panel || !input || !status || !results) {
    return;
  }

  const rootElement = root;
  const inputElement = input;
  const statusElement = status;
  const resultsElement = results;
  let lastFocusedElement: HTMLElement | null = null;
  hint && (hint.textContent = formatHint());

  function setOpen(nextOpen: boolean): void {
    rootElement.hidden = !nextOpen;
    rootElement.toggleAttribute("inert", !nextOpen);
    rootElement.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    document.body.classList.toggle("site-search-open", nextOpen);

    if (nextOpen) {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void renderResults(inputElement.value);
      window.requestAnimationFrame(() => {
        inputElement.focus();
        inputElement.select();
      });
      return;
    }

    inputElement.blur();
    lastFocusedElement?.focus();
  }

  function renderEntry(entry: SiteSearchEntry): string {
    const kindLabel = entry.kind === "page" ? "Page" : entry.kind === "region" ? "Region" : "Place";
    const kindTone = entry.kind === "page" ? "accent" : entry.kind === "region" ? "warm" : "teal";

    return `
      <a class="site-search-result" href="${escapeHtml(entry.href)}">
        <div class="chip-row">
          <span class="chip ${kindTone}">${kindLabel}</span>
          <span class="chip">${escapeHtml(entry.kicker)}</span>
        </div>
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(entry.description)}</p>
        <span class="tiny">${escapeHtml(entry.href)}</span>
      </a>
    `;
  }

  async function renderResults(query: string): Promise<void> {
    statusElement.textContent = "Loading search index...";

    try {
      const entries = await loadEntries();
      const trimmedQuery = query.trim();
      const ranked = entries
        .map((entry) => ({ entry, score: scoreEntry(entry, trimmedQuery) }))
        .filter((item) => item.score >= 0)
        .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
        .slice(0, trimmedQuery ? 10 : 8)
        .map((item) => item.entry);

      if (ranked.length === 0) {
        statusElement.textContent = `No matches for "${trimmedQuery}"`;
        resultsElement.innerHTML = `
          <article class="site-search-empty">
            <strong>No matching pages, regions, or places</strong>
            <p>Try a region, local authority, area code, or topic like routes or sources.</p>
          </article>
        `;
        return;
      }

      statusElement.textContent = trimmedQuery
        ? `${ranked.length} search result${ranked.length === 1 ? "" : "s"}`
        : "Popular pages, regions, and place profiles";
      resultsElement.innerHTML = ranked.map(renderEntry).join("");
    } catch (error) {
      console.error(error);
      statusElement.textContent = "Search is temporarily unavailable";
      resultsElement.innerHTML = `
        <article class="site-search-empty">
          <strong>Search index unavailable</strong>
          <p>The rest of the site still works, but the search index could not be loaded.</p>
        </article>
      `;
    }
  }

  for (const button of openButtons) {
    button.addEventListener("click", () => setOpen(true));
  }

  for (const button of closeButtons) {
    button.addEventListener("click", () => setOpen(false));
  }

  root.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("[data-site-search-panel]")) {
      if (target.closest(".site-search-result")) {
        setOpen(false);
      }
      return;
    }

    if (target.closest("[data-site-search-close]")) {
      return;
    }

    setOpen(false);
  });

  panel.addEventListener("click", (event) => event.stopPropagation());

  inputElement.addEventListener("input", () => {
    void renderResults(inputElement.value);
  });

  inputElement.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await renderResults(inputElement.value);
    const firstResult = resultsElement.querySelector<HTMLAnchorElement>(".site-search-result");

    if (firstResult) {
      window.location.href = firstResult.href;
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTypingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if ((event.key === "/" && !isTypingTarget) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (event.key === "Escape" && !rootElement.hidden) {
      event.preventDefault();
      setOpen(false);
    }
  });

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => {
      void loadEntries();
    });
  } else {
    globalThis.setTimeout(() => {
      void loadEntries();
    }, 1500);
  }

  rootElement.hidden = true;
  rootElement.toggleAttribute("inert", true);
  rootElement.setAttribute("aria-hidden", "true");
}
