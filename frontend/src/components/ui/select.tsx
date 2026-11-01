import * as React from "react"
import { cn } from "@/lib/utils"

// A native select: keyboard, screen reader and touch behaviour come from the browser. Styled like Input.
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-sm pointer-coarse:min-h-11 pointer-coarse:text-[16px] transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Select }
