import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Local Tailwind-aware `className` combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
