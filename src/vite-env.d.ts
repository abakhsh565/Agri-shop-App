/// <reference types="vite/client" />

/**
 * The release id `vite.config.ts` injects at build time: the commit sha from Vercel or GitHub
 * Actions, or whatever a workflow named with `VITE_RELEASE`. Empty when the build was not made by
 * CI. Read through `resolveReleaseId()` in `src/lib/errorReporting.ts`, never directly.
 */
declare const __APP_RELEASE__: string;
