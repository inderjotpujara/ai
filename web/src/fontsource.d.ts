// TypeScript 6 turns on `noUncheckedSideEffectImports` by default, which now
// type-checks side-effect imports (e.g. `import '@fontsource-variable/geist'`
// in main.tsx). The `@fontsource-variable/*` packages ship CSS only — no type
// declarations — so those imports fail with TS2882 ("Cannot find module or
// type declarations for side-effect import"). These are legitimate
// CSS-injecting font imports, not typos, so declare the module space as
// ambient to satisfy the checker while still catching real typos elsewhere.
declare module '@fontsource-variable/*';
