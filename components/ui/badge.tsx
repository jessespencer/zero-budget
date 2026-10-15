import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva("badge", {
  variants: {
    intent: {
      neutral: "badge-neutral",
      positive: "badge-positive",
      negative: "badge-negative",
      warning: "badge-warning",
      info: "badge-info",
      brand: "badge-brand",
    },
  },
  defaultVariants: {
    intent: "neutral",
  },
})

function Badge({
  className,
  intent = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ intent }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      intent,
    },
  })
}

export { Badge, badgeVariants }
