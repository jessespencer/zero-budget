import { cn } from "@/lib/utils"

// shadcn Kbd. TooltipContent already has the data-slot="kbd" hooks; inside a
// tooltip (inverted surface) the chip flips to a translucent background.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none",
        "in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
