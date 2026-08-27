import type { ButtonHTMLAttributes, CSSProperties } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  isLoading?: boolean;
}

const base =
  "rounded-full px-5 py-2.5 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2";

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "text-[var(--accent-contrast)]",
  ghost: "glass-panel-sm hover:brightness-110",
  danger: "glass-panel-sm hover:brightness-110",
};

export function Button({
  variant = "primary",
  isLoading = false,
  className = "",
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const variantStyle: CSSProperties =
    variant === "primary"
      ? { background: "var(--accent)", ...style }
      : variant === "danger"
        ? { color: "var(--color-coral)", ...style }
        : { color: "var(--text-primary)", ...style };

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      style={variantStyle}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading && (
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
