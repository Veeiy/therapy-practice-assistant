// Ambient module declarations so TypeScript understands Vite's `?raw` imports.
// `import sql from './x.sql?raw'` yields the file contents as a string.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
declare module '*?raw' {
  const content: string;
  export default content;
}
