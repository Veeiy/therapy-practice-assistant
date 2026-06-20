// Ambient declaration so TypeScript accepts the CSS side-effect import in the
// renderer (`import './styles.css'`). Vite handles the actual stylesheet at build
// time; tsc only needs to know the module exists.
declare module '*.css';
