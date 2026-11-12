import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, business: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const { user, business } = await api.get('/auth/me');
      setState({ user, business, loading: false, error: null });
    } catch (error) {
      if (error.status === 401)
        setState({ user: null, business: null, loading: false, error: null });
      else setState({ user: null, business: null, loading: false, error });
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() =>
      setState({ user: null, business: null, loading: false, error: null }),
    );
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setState({ user: null, business: null, loading: false, error: null });
  }, []);

  const value = useMemo(() => ({ ...state, refresh, logout }), [state, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
