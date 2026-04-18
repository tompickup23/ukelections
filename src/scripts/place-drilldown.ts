export function initPlaceDrilldown(): void {
  const root = document.getElementById("place-drilldown");

  if (!(root instanceof HTMLElement)) {
    return;
  }

  const form = root.querySelector<HTMLFormElement>("[data-place-drill-form]");
  const summary = root.querySelector<HTMLElement>("[data-place-drill-summary]");
  const reset = root.querySelector<HTMLButtonElement>("[data-place-drill-reset]");
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-place-drill-panel]"));

  if (!form || !summary || panels.length === 0) {
    return;
  }

  const metricSelect = form.querySelector<HTMLSelectElement>('select[name="place_metric"]');
  const scopeSelect = form.querySelector<HTMLSelectElement>('select[name="place_scope"]');

  if (!metricSelect || !scopeSelect) {
    return;
  }

  const summaryElement = summary;
  const metric = metricSelect;
  const scope = scopeSelect;

  function readStateFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    metric.value = params.get("place_metric") ?? "supported_asylum";
    scope.value = params.get("place_scope") ?? "regional";
  }

  function writeStateToUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const nextEntries = {
      place_metric: metric.value,
      place_scope: scope.value
    };

    for (const [key, currentValue] of Object.entries(nextEntries)) {
      const defaultValue = key === "place_metric" ? "supported_asylum" : "regional";

      if (currentValue === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, currentValue);
      }
    }

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function applyState(): void {
    const selectedPanel = panels.find(
      (panel) => panel.dataset.metric === metric.value && panel.dataset.scope === scope.value
    );

    for (const panel of panels) {
      panel.hidden = panel !== selectedPanel;
    }

    if (selectedPanel) {
      summaryElement.textContent =
        selectedPanel.dataset.summary ??
        `${metric.options[metric.selectedIndex]?.textContent ?? "Selected metric"} | ${scope.value}`;
    }
  }

  function onChange(): void {
    writeStateToUrl();
    applyState();
  }

  readStateFromUrl();
  applyState();

  form.addEventListener("input", onChange);
  form.addEventListener("change", onChange);
  reset?.addEventListener("click", () => {
    form.reset();
    metric.value = "supported_asylum";
    scope.value = "regional";
    onChange();
  });
}
