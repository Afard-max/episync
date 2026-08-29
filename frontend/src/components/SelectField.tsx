import { forwardRef, type SelectHTMLAttributes } from "react";

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, id, className = "", children, ...rest }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`glass-panel-sm rounded-xl px-3 py-2.5 ${className}`}
          style={{ color: "var(--text-primary)" }}
          {...rest}
        >
          {children}
        </select>
      </div>
    );
  }
);
SelectField.displayName = "SelectField";
