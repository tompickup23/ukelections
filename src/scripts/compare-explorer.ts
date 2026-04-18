import { wireShareState } from "./share-state";

type CompareFocus = "supported" | "rate" | "contingency" | "humanitarian" | "resettlement";

interface CompareItem {
  element: HTMLElement;
  name: string;
  region: string;
  country: string;
  model: string;
  supported: number;
  rate: number;
  contingency: number;
  humanitarian: number;
  resettlement: number;
}

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMetric(item: CompareItem, focus: CompareFocus): number {
  switch (focus) {
    case "rate":
      return item.rate;
    case "contingency":
      return item.contingency;
    case "humanitarian":
      return item.humanitarian;
    case "resettlement":
      return item.resettlement;
    default:
      return item.supported;
  }
}

export function initCompareExplorer(): void {
  const root = document.getElementById("compare-explorer");

  if (!(root instanceof HTMLElement)) {
    return;
  }

  const form = root.querySelector<HTMLFormElement>("[data-compare-form]");
  const resultsElement = root.querySelector<HTMLElement>("[data-compare-results]");
  const summaryElement = root.querySelector<HTMLElement>("[data-compare-summary]");
  const emptyElement = root.querySelector<HTMLElement>("[data-compare-empty]");
  const reset = root.querySelector<HTMLButtonElement>("[data-compare-reset]");
  const copy = root.querySelector<HTMLButtonElement>("[data-compare-copy]");
  const copyStatus = root.querySelector<HTMLElement>("[data-compare-copy-status]");

  if (!form || !resultsElement || !summaryElement || !emptyElement) {
    return;
  }

  const searchInput = form.querySelector<HTMLInputElement>('input[name="compare_q"]');
  const regionSelect = form.querySelector<HTMLSelectElement>('select[name="compare_region"]');
  const countrySelect = form.querySelector<HTMLSelectElement>('select[name="compare_country"]');
  const focusSelect = form.querySelector<HTMLSelectElement>('select[name="compare_focus"]');
  const modelSelect = form.querySelector<HTMLSelectElement>('select[name="compare_model"]');
  const limitSelect = form.querySelector<HTMLSelectElement>('select[name="compare_limit"]');

  if (!searchInput || !regionSelect || !countrySelect || !focusSelect || !modelSelect || !limitSelect) {
    return;
  }

  const results = resultsElement;
  const summary = summaryElement;
  const empty = emptyElement;
  const search = searchInput;
  const region = regionSelect;
  const country = countrySelect;
  const focus = focusSelect;
  const model = modelSelect;
  const limit = limitSelect;
  const share = wireShareState({
    button: copy,
    statusElement: copyStatus,
    getUrl: () => new URL(buildRelativeUrl(), window.location.origin).toString(),
    successMessage: "Filtered compare view copied"
  });

  const items = Array.from(results.querySelectorAll<HTMLElement>("[data-compare-item]")).map((element) => ({
    element,
    name: element.dataset.name ?? "",
    region: element.dataset.region ?? "",
    country: element.dataset.country ?? "",
    model: element.dataset.model ?? "balanced",
    supported: toNumber(element.dataset.supported),
    rate: toNumber(element.dataset.rate),
    contingency: toNumber(element.dataset.contingency),
    humanitarian: toNumber(element.dataset.humanitarian),
    resettlement: toNumber(element.dataset.resettlement)
  }));

  function readStateFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    search.value = params.get("compare_q") ?? "";
    region.value = params.get("compare_region") ?? "all";
    country.value = params.get("compare_country") ?? "all";
    focus.value = params.get("compare_focus") ?? "supported";
    model.value = params.get("compare_model") ?? "all";
    limit.value = params.get("compare_limit") ?? "12";
  }

  function buildRelativeUrl(): string {
    const params = new URLSearchParams(window.location.search);
    const nextEntries = {
      compare_q: search.value.trim(),
      compare_region: region.value,
      compare_country: country.value,
      compare_focus: focus.value,
      compare_model: model.value,
      compare_limit: limit.value
    };

    for (const [key, value] of Object.entries(nextEntries)) {
      const defaultValue =
        key === "compare_focus"
          ? "supported"
          : key === "compare_limit"
            ? "12"
            : key === "compare_q"
              ? ""
              : "all";

      if (!value || value === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    return `${window.location.pathname}${query ? `?${query}` : ""}#compare-explorer`;
  }

  function writeStateToUrl(): void {
    window.history.replaceState({}, "", buildRelativeUrl());
  }

  function applyFilters(): void {
    const searchValue = search.value.trim().toLowerCase();
    const regionValue = region.value;
    const countryValue = country.value;
    const focusValue = (focus.value as CompareFocus) || "supported";
    const modelValue = model.value;
    const limitValue = Math.max(1, toNumber(limit.value) || 12);

    const visible = items.filter((item) => {
      const matchesSearch =
        !searchValue ||
        item.name.toLowerCase().includes(searchValue) ||
        item.region.toLowerCase().includes(searchValue) ||
        item.country.toLowerCase().includes(searchValue);
      const matchesRegion = regionValue === "all" || item.region === regionValue;
      const matchesCountry = countryValue === "all" || item.country === countryValue;
      const matchesModel = modelValue === "all" || item.model === modelValue;

      return matchesSearch && matchesRegion && matchesCountry && matchesModel;
    });

    visible.sort((left, right) => {
      return (
        getMetric(right, focusValue) - getMetric(left, focusValue) ||
        right.supported - left.supported ||
        left.name.localeCompare(right.name)
      );
    });

    for (const item of items) {
      item.element.hidden = true;
    }

    visible.forEach((item, index) => {
      results.appendChild(item.element);
      item.element.hidden = index >= limitValue;
    });

    const renderedCount = Math.min(visible.length, limitValue);
    summary.textContent = `Showing ${renderedCount} of ${visible.length} matching places`;
    empty.hidden = visible.length !== 0;
  }

  function onChange(): void {
    writeStateToUrl();
    share.setStatus("");
    applyFilters();
  }

  readStateFromUrl();
  applyFilters();

  form.addEventListener("input", onChange);
  form.addEventListener("change", onChange);
  reset?.addEventListener("click", () => {
    form.reset();
    region.value = "all";
    country.value = "all";
    focus.value = "supported";
    model.value = "all";
    limit.value = "12";
    onChange();
  });
}
