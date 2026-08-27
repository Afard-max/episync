import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { ApiError, createUser } from "../lib/api";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

type Mode = "login" | "signup";

// Decisión de UX propia, no pedida por el SDD §3.6.2 (que no detalla esta
// pantalla en absoluto): un solo formulario con dos modos, en vez de dos
// pantallas separadas, porque el caso de uso real es "uno o dos usuarios
// personales" — no amerita un flujo de registro con más peso visual que
// el propio login.
export function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [inviteSecret, setInviteSecret] = useState("");
  // Tras un alta exitosa, se muestra la key generada una única vez (nunca
  // más se puede recuperar, ver §3.6.2.5 del SDD) antes de continuar.
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(apiKeyInput.trim());
    } catch (err) {
      setError(describeError(err, "login"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignup(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await createUser({
        display_name: displayName.trim(),
        invite_secret: inviteSecret,
      });
      setGeneratedKey(result.api_key);
    } catch (err) {
      setError(describeError(err, "signup"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleContinueAfterSignup() {
    if (!generatedKey) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await login(generatedKey);
    } catch (err) {
      setError(describeError(err, "login"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyKey() {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="ambient-glow min-h-dvh flex items-center justify-center p-6">
      <div className="glass-panel rounded-3xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-semibold mb-1">EpisoSync</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          Sincronización asistida AnimeAV1 → MyAnimeList
        </p>

        {generatedKey ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Cuenta creada. Esta es tu API key —{" "}
              <strong style={{ color: "var(--color-amber)" }}>
                guardala ahora
              </strong>
              , no se puede volver a mostrar más adelante.
            </p>
            <div className="glass-panel-sm rounded-xl p-4 flex items-center justify-between gap-3">
              <code className="text-sm font-mono break-all">
                {generatedKey}
              </code>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={copyKey}
              className="w-full"
            >
              {copied ? "Copiada ✓" : "Copiar al portapapeles"}
            </Button>
            <Button
              type="button"
              onClick={handleContinueAfterSignup}
              isLoading={isSubmitting}
              className="w-full"
            >
              Ya la guardé, continuar
            </Button>
            {error && <FormError message={error} />}
          </div>
        ) : (
          <>
            <div className="flex gap-1 mb-6 glass-panel-sm rounded-full p-1 text-sm">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="flex-1 rounded-full py-1.5 font-medium transition"
                style={
                  mode === "login"
                    ? { background: "var(--accent)", color: "var(--accent-contrast)" }
                    : { color: "var(--text-secondary)" }
                }
              >
                Ingresar
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="flex-1 rounded-full py-1.5 font-medium transition"
                style={
                  mode === "signup"
                    ? { background: "var(--accent)", color: "var(--accent-contrast)" }
                    : { color: "var(--text-secondary)" }
                }
              >
                Crear cuenta
              </button>
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <TextField
                  label="API key"
                  type="password"
                  autoComplete="current-password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  required
                />
                {error && <FormError message={error} />}
                <Button
                  type="submit"
                  isLoading={isSubmitting}
                  disabled={!apiKeyInput.trim()}
                  className="w-full mt-1"
                >
                  Ingresar
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="flex flex-col gap-4">
                <TextField
                  label="Tu nombre"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={80}
                />
                <TextField
                  label="Clave de invitación"
                  type="password"
                  value={inviteSecret}
                  onChange={(e) => setInviteSecret(e.target.value)}
                  required
                />
                {error && <FormError message={error} />}
                <Button
                  type="submit"
                  isLoading={isSubmitting}
                  disabled={!displayName.trim() || !inviteSecret}
                  className="w-full mt-1"
                >
                  Crear cuenta
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p
      className="text-sm glass-panel-sm rounded-lg px-3 py-2"
      style={{ color: "var(--color-coral)" }}
      role="alert"
    >
      {message}
    </p>
  );
}

function describeError(err: unknown, context: "login" | "signup"): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message; // fallo de red, ya viene claro
    if (context === "login" && err.status === 401) {
      return "API key inválida. Revisá que la hayas copiado completa.";
    }
    if (context === "signup" && err.code === "invalid_invite_secret") {
      return "Clave de invitación incorrecta.";
    }
    return err.message;
  }
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}
