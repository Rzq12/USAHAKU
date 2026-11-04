import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
const VISIBLE_MS = 4000;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const show = useCallback((message, tone = 'success') => {
    clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex justify-center sm:bottom-6"
      >
        {toast && (
          <p
            className={`pointer-events-auto max-w-md rounded-md px-4 py-3 text-body-sm font-medium shadow-modal ${
              toast.tone === 'warning'
                ? 'bg-tint-yellow-bold text-charcoal'
                : 'bg-ink-deep text-white'
            }`}
          >
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
