import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { FormError } from './ui.jsx';

/**
 * Native dialog: the browser traps focus, closes on Escape, and returns focus on close.
 * A bottom sheet on phones and a centered panel from the sm breakpoint.
 */
export function Drawer({ open, onClose, title, children, footer, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-label={title}
      className={`drawer m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-xl bg-white text-ink shadow-modal sm:m-auto sm:rounded-lg ${
        wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
      }`}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <h2 className="text-h5">{title}</h2>
            <button
              type="button"
              className="btn-ghost -mr-2 w-11 px-0"
              onClick={onClose}
              aria-label="Tutup"
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="safe-bottom flex flex-wrap justify-end gap-2 border-t border-hairline px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive actions; stays open and shows the reason when the action fails. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  danger = true,
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={pending}
            onClick={confirm}
          >
            {pending ? 'Memproses...' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-body-sm text-charcoal">{body}</p>
      <FormError message={error} />
    </Drawer>
  );
}
