import { NavLink } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";

const navLinkStyle = (isActive: boolean) => ({
  color: isActive ? "var(--accent)" : "var(--text-secondary)",
  fontWeight: isActive ? 600 : 500,
});

export function Topbar() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="glass-panel-sm sticky top-0 z-10 flex items-center justify-between px-6 py-4 gap-4 flex-wrap">
      <div className="flex items-center gap-6">
        <span className="font-display text-lg font-semibold tracking-tight">
          EpisoSync
        </span>
        <nav className="flex items-center gap-4 text-sm">
          <NavLink to="/" end style={({ isActive }) => navLinkStyle(isActive)}>
            Dashboard
          </NavLink>
          <NavLink
            to="/configuracion/watchlist"
            style={({ isActive }) => navLinkStyle(isActive)}
          >
            Watchlist
          </NavLink>
          <NavLink
            to="/configuracion/cuenta"
            style={({ isActive }) => navLinkStyle(isActive)}
          >
            Cuenta
          </NavLink>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <span
            className="hidden sm:inline text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {user.display_name}
          </span>
        )}

        <button
          onClick={toggleTheme}
          aria-label={`Cambiar a modo ${theme === "dark" ? "claro" : "oscuro"}`}
          className="glass-panel-sm rounded-full h-11 w-11 flex items-center justify-center hover:brightness-110 transition"
        >
          {theme === "dark" ? "☀︎" : "☾"}
        </button>

        {user && (
          <button
            onClick={logout}
            className="text-sm font-medium hover:opacity-70 transition"
            style={{ color: "var(--color-dusk-dim)" }}
          >
            Salir
          </button>
        )}
      </div>
    </header>
  );
}
