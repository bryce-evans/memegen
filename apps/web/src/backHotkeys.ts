import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Keys that go back a page. */
const BACK_KEYS = new Set(["Backspace", "Delete", "Escape"]);

/** Confirmation messages from mounted guards (e.g. an unpublished meme in the editor); the latest one is asked. */
const guards: string[] = [];

/** While mounted with a message, going back by hotkey first asks the user to confirm it; null turns the guard off. */
export function useBackGuard(message: string | null): void {
  useEffect(() => {
    if (message === null) return;
    guards.push(message);
    return () => {
      guards.splice(guards.lastIndexOf(message), 1);
    };
  }, [message]);
}

/** True when the key belongs to whatever has focus or is open: a text field, a dialog, an open dropdown. */
function keyIsTaken(e: KeyboardEvent): boolean {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return true;
  return document.querySelector("dialog[open], .ui-dropdown[data-open]") !== null;
}

/**
 * Backspace, Delete, and Escape go back to the previous page in the app, as the browser's Back would. They stay with
 * text fields, dialogs, and open dropdowns, never act with a modifier held (⌘⌫ removes an editor layer), and do
 * nothing on the first page of the visit, so they never leave the site. Mount once, above the routes.
 */
export function useBackHotkeys(): void {
  const navigate = useNavigate();
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!BACK_KEYS.has(e.key) || e.defaultPrevented || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || keyIsTaken(e)) return;
      // React Router numbers its history entries; 0 is where this visit started.
      const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (index === 0) return;
      e.preventDefault();
      const guard = guards.at(-1);
      if (guard !== undefined && !window.confirm(guard)) return;
      navigate(-1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
}
