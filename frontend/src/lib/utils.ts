import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Without this, text-prose counts as a text colour and cancels text-foreground.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["prose"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
