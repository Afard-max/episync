import type { ReactNode } from "react";

type BadgeVariant = "mint" | "amber" | "coral" | "dusk";

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
}

const colorVar: Record<BadgeVariant, string> = {
  mint: "var(--color-mint)",
  amber: "var(--color-amber)",
  coral: "var(--color-coral)",
  dusk: "var(--color-dusk-dim)",
};

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${colorVar[variant]} 20%, transparent)`,
        color: colorVar[variant],
      }}
    >
      {children}
    </span>
  );
}
