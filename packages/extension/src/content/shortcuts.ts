type ShortcutHandlers = {
  capture: () => void;
  annotateLast: () => void;
  dismiss: () => void;
};

export function installShortcuts({
  capture,
  annotateLast,
  dismiss,
}: ShortcutHandlers): void {
  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as HTMLElement | null;

      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (
        event.altKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.code === 'KeyM'
      ) {
        if (typing) return;

        event.preventDefault();
        event.stopPropagation();
        capture();
        return;
      }

      if (
        event.altKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.code === 'KeyN'
      ) {
        if (typing) return;

        event.preventDefault();
        event.stopPropagation();
        annotateLast();
        return;
      }

      if (event.key === 'Escape') {
        dismiss();
      }
    },
    true,
  );
}
