import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { uiText } from '../ui/text.ts';

// Keep fixed dialogs outside cards: card transforms otherwise change their containing block.
export function ListDeleteDialog({ id, title, children, error, busy, busyLabel = uiText.feedback.deleting, confirmLabel, onClose, onConfirm, theme }: {
  id: string; title: string; children?: React.ReactNode; error?: string; busy: boolean;
  busyLabel?: string; confirmLabel: string; onClose: () => void; onConfirm: () => void | Promise<void>; theme?: string | null;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onClose();
      } else if (event.key === 'Tab') {
        const buttons = [...dialogRef.current!.querySelectorAll<HTMLElement>('button:not([disabled])')];
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        event.stopPropagation();
        if (buttons.length) buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<div className="workspace-shell list-delete-backdrop" data-theme={theme} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={dialogRef} className="list-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id} aria-busy={busy}>
      <h2 id={id}>{title}</h2>
      <p>{children}</p>
      {error && <p className="list-delete-dialog__error" role="alert">{error}</p>}
      <div className="list-delete-dialog__actions">
        <button type="button" onClick={onClose} disabled={busy}>{uiText.actions.cancel}</button>
        <button type="button" onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </section>
  </div>, document.body);
}
