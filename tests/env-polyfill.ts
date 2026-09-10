// Polyfill import.meta.env for tsx runs in Node.js
// esbuild (used by tsx) populates import.meta.env from process.env['VITE_*']
// when running .ts/.mts files
export {};
