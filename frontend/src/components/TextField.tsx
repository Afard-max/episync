import { forwardRef, type InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, error, id, className = "", ...rest }, ref) => {
    const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-sm font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={`glass-panel-sm rounded-xl px-4 py-2.5 outline-none placeholder:opacity-40 ${className}`}
          style={{ color: "var(--text-primary)" }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...rest}
        />
        {error && (
          <p
            id={`${inputId}-error`}
            className="text-sm"
            style={{ color: "var(--color-coral)" }}
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);
TextField.displayName = "TextField";
