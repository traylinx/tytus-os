import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// twMerge needs to know our semantic radius aliases (rounded-button,
// rounded-input, rounded-card, rounded-window, rounded-dialog, rounded-toast,
// rounded-dock, rounded-menu) belong to the same conflict group as the
// stock rounded-* utilities. Without this extension, cn('rounded-input',
// 'rounded-none') keeps BOTH classes (last-wins is the default Tailwind
// emission order), which is unpredictable for callers that want to
// override a primitive's radius default.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // The default 'rounded' group covers rounded, rounded-{xs,sm,md,lg,xl,2xl,3xl,full,none}.
      // We add our semantic aliases so they participate in conflict resolution.
      'rounded': [
        { rounded: ['button', 'input', 'card', 'window', 'dialog', 'toast', 'dock', 'menu'] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
