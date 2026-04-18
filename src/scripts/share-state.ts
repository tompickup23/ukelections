interface ShareStateOptions {
  button?: HTMLButtonElement | null;
  statusElement?: HTMLElement | null;
  getUrl: () => string;
  successMessage: string;
  failureMessage?: string;
}

interface LegacyCopyDocument extends Document {
  execCommand(commandId: "copy"): boolean;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const legacyDocument = document as LegacyCopyDocument;
    return legacyDocument.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export function wireShareState({
  button,
  statusElement,
  getUrl,
  successMessage,
  failureMessage = "Copy failed. Use the address bar URL."
}: ShareStateOptions): { setStatus: (message: string) => void } {
  let clearStatusHandle = 0;

  function setStatus(message: string): void {
    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;

    if (clearStatusHandle) {
      window.clearTimeout(clearStatusHandle);
      clearStatusHandle = 0;
    }

    if (message) {
      clearStatusHandle = window.setTimeout(() => {
        statusElement.textContent = "";
      }, 2800);
    }
  }

  button?.addEventListener("click", async () => {
    const copied = await copyText(getUrl());
    setStatus(copied ? successMessage : failureMessage);
  });

  return { setStatus };
}
