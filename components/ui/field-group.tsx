import { cn } from "@/lib/utils";

type FieldGroupProps = {
  /**
   * Usually a string. Accepts a node so a field can hang a help tooltip off
   * its label without forking the label classes — schedule-dialog's "Weekend
   * handling" was hand-rolling this whole component to do exactly that. Node
   * labels supply their own layout; the `block` below only applies to the
   * default string case.
   */
  label: React.ReactNode;
  htmlFor?: string;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function FieldGroup({ label, htmlFor, optional, children, className }: FieldGroupProps) {
  return (
    <div className={cn(className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          "text-sm font-medium text-muted-foreground mb-1.5",
          typeof label === "string" ? "block" : "flex items-center gap-1"
        )}
      >
        {label}
        {optional && (
          <span className="text-muted-foreground font-normal"> (optional)</span>
        )}
      </label>
      {children}
    </div>
  );
}
