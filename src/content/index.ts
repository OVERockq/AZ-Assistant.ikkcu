import type { ContentRequest, PageContext, ReplaceResult } from "../shared/types";

let lastEditable: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;
let lastContentEditableRange: Range | null = null;

const isTextInput = (element: Element | null): element is HTMLInputElement => {
  if (!(element instanceof HTMLInputElement)) return false;
  return ["", "text", "search", "url", "tel", "email", "password"].includes(element.type);
};

const getEditableKind = (element: Element | null): PageContext["editableKind"] => {
  if (isTextInput(element)) return "input";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLElement && element.isContentEditable) return "contenteditable";
  return "none";
};

const rememberEditable = (event: Event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const kind = getEditableKind(target);
  if (kind !== "none") {
    lastEditable = target as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
  }
};

document.addEventListener("focusin", rememberEditable, true);
document.addEventListener("selectionchange", () => {
  const active = document.activeElement;
  if (getEditableKind(active) !== "none") {
    lastEditable = active as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
  }
  const selection = document.getSelection();
  if (
    active instanceof HTMLElement &&
    active.isContentEditable &&
    selection &&
    selection.rangeCount > 0 &&
    selection.toString().length > 0
  ) {
    lastContentEditableRange = selection.getRangeAt(0).cloneRange();
  }
});

const getSelectedTextFromEditable = (element: Element | null): string => {
  if (isTextInput(element) || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    return element.value.slice(start, end);
  }
  const currentSelection = document.getSelection()?.toString() ?? "";
  if (currentSelection) return currentSelection;
  return lastContentEditableRange?.toString() ?? "";
};

const getSurroundingText = (selectedText: string): string => {
  const active = document.activeElement;
  if (isTextInput(active) || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? 0;
    return active.value.slice(Math.max(0, start - 700), start + 700);
  }
  const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
  if (!selectedText) return bodyText.slice(0, 1400);
  const index = bodyText.indexOf(selectedText);
  if (index < 0) return bodyText.slice(0, 1400);
  return bodyText.slice(Math.max(0, index - 700), index + selectedText.length + 700);
};

const getPageContext = (): PageContext => {
  const active = document.activeElement;
  const kind = getEditableKind(active) !== "none" ? getEditableKind(active) : getEditableKind(lastEditable);
  const selectedText = getSelectedTextFromEditable(kind !== "none" ? active : lastEditable);
  return {
    title: document.title,
    url: location.href,
    selectedText,
    editable: kind !== "none",
    editableKind: kind,
    surroundingText: getSurroundingText(selectedText)
  };
};

const replaceSelection = (text: string): ReplaceResult => {
  const active = document.activeElement;
  const target = getEditableKind(active) !== "none" ? active : lastEditable;

  if (isTextInput(target) || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start === null || end === null || start === end) {
      return { ok: false, reason: "선택된 입력 영역이 없습니다." };
    }
    target.setRangeText(text, start, end, "select");
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.focus();
    return { ok: true };
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    const selection = document.getSelection();
    const range =
      selection && selection.rangeCount > 0 && selection.toString().length > 0
        ? selection.getRangeAt(0)
        : lastContentEditableRange;
    if (!range || range.toString().length === 0) {
      return { ok: false, reason: "contenteditable 선택 영역을 찾을 수 없습니다." };
    }
    if (!target.contains(range.commonAncestorContainer)) {
      return { ok: false, reason: "선택 영역이 마지막 편집 영역 안에 있지 않습니다." };
    }
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    selection?.removeAllRanges();
    lastContentEditableRange = null;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    target.focus();
    return { ok: true };
  }

  return { ok: false, reason: "지원되는 편집 영역(input, textarea, contenteditable)이 아닙니다." };
};

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTEXT") {
    sendResponse(getPageContext());
    return;
  }
  if (message.type === "REPLACE_SELECTION") {
    sendResponse(replaceSelection(message.text));
  }
});
