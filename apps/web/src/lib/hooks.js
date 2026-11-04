import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useToast } from '../components/Toast.jsx';

const CHANGED_EVENT = 'usahaku:changed';

/** Tells every mounted list that records changed, for writes made outside the page, like Add. */
export function notifyChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Loads a GET path; path null skips loading. Stale responses are ignored. */
export function useFetch(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onChanged = () => setNonce((value) => value + 1);
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, error: null, loading: true }));
    api
      .get(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}

/**
 * Submit state for one form. Keeps entered data on failure (the caller holds it), exposes
 * per-field errors, and shows the API message when no field carries it.
 */
export function useSubmit(action, { success, onDone } = {}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const inFlight = useRef(false);

  const submit = useCallback(
    async (...args) => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setPending(true);
      setFieldErrors({});
      setFormError(null);
      try {
        const result = await action(...args);
        const message = typeof success === 'function' ? success(result) : success;
        if (message) toast.show(message);
        onDone?.(result);
        return result;
      } catch (error) {
        const hasFields = Object.keys(error.fields ?? {}).length > 0;
        setFieldErrors(error.fields ?? {});
        if (!hasFields) setFormError(error.message);
        return undefined;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [action, success, onDone, toast],
  );

  return { submit, pending, fieldErrors, formError };
}

export function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
