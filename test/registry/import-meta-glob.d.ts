// The slice of Vite's `import.meta.glob` typing used by the registry suite (vite is not a
// direct dependency of the root package, so `vite/client` types aren't resolvable here).
interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true }): Record<string, T>;
}
