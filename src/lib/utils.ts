import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: unknown) {
  if (typeof value !== "number") return value == null ? "—" : String(value);
  return new Intl.NumberFormat().format(value);
}
