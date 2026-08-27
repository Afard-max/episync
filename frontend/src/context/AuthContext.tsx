import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "../lib/api";
import * as api from "../lib/api";
import type { UserMe } from "../lib/types";

const STORAGE_KEY = "episosync:apiKey";

interface AuthContextValue {
  apiKey: string | null;
  user: UserMe | null;
  /** true mientras se valida una api key ya guardada al cargar la app. */
  isInitializing: boolean;
  /** Intenta autenticar con esta api key contra GET /users/me. Si es
   *  válida, la persiste y actualiza el estado; si no, la descarta y
   *  relanza el ApiError para que la pantalla de login muestre el motivo
   *  exacto (401 unauthorized vs. un error de red). */
  login: (apiKey: string) => Promise<void>;
  logout: () => void;
  /** Vuelve a pedir /users/me con la key actual — útil después de
   *  conectar MAL o cambiar la temporada activa, para reflejar el
   *  estado real sin forzar un logout/login. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [user, setUser] = useState<UserMe | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Al montar, si había una api key guardada de una sesión anterior, se
  // revalida contra el backend en vez de asumir que sigue siendo válida
  // (pudo haberse revocado, o el usuario borrado).
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setIsInitializing(false);
      return;
    }
    api
      .getMe(stored)
      .then((me) => {
        setApiKey(stored);
        setUser(me);
      })
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
      })
      .finally(() => setIsInitializing(false));
  }, []);

  const login = useCallback(async (candidateKey: string) => {
    const me = await api.getMe(candidateKey); // deja que el ApiError se propague
    window.localStorage.setItem(STORAGE_KEY, candidateKey);
    setApiKey(candidateKey);
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!apiKey) return;
    try {
      const me = await api.getMe(apiKey);
      setUser(me);
    } catch (err) {
      // Si la key dejó de ser válida entre medio (ej. el usuario fue
      // eliminado del lado del backend), se cierra sesión en vez de
      // dejar a la UI mostrando datos de un usuario que ya no existe.
      if (err instanceof ApiError && err.status === 401) {
        logout();
      } else {
        throw err;
      }
    }
  }, [apiKey, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({ apiKey, user, isInitializing, login, logout, refreshUser }),
    [apiKey, user, isInitializing, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  }
  return ctx;
}
