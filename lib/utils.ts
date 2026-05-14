// Small utility for merging Tailwind class names cleanly.
// Used so we can write `cn('base classes', conditional && 'extra')` instead of
// hand-managing string concatenation.

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
