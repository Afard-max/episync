import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

function FullScreenLoader() {
  return (
    <div className="ambient-glow min-h-dvh flex items-center justify-center">
      <div
        className="h-8 w-8 rounded-full border-2 border-current border-t-transparent animate-spin"
        style={{ color: "var(--accent)" }}
        aria-label="Cargando"
      />
    </div>
  );
}

/** Envuelve pantallas que requieren sesión (todo salvo /login). Redirige
 * a /login si no hay api key válida; muestra loader mientras se revalida
 * una key persistida de una sesión anterior. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { apiKey, isInitializing } = useAuth();

  if (isInitializing) return <FullScreenLoader />;
  if (!apiKey) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Envuelve /login: si ya hay sesión válida, no tiene sentido mostrar el
 * formulario de nuevo — se redirige directo al dashboard. */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { apiKey, isInitializing } = useAuth();

  if (isInitializing) return <FullScreenLoader />;
  if (apiKey) return <Navigate to="/" replace />;
  return <>{children}</>;
}
