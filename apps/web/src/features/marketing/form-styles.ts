// Marketing forms use native elements with the design-system look instead of the @crm/ui
// components, which bring Radix, cva and tailwind-merge into the public bundle (TC-PERF-001:
// ≤ 150 KB initial JS). Keep these in step with packages/ui input/label/button defaults.

export const labelClass = "text-sm leading-none font-medium";

export const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

export const buttonClass =
  "inline-flex h-9 items-center justify-center self-start rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";
