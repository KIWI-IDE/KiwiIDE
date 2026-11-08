/// <reference types="vite/client" />

/**
 * Values Vite substitutes at build time.
 *
 * The renderer cannot read package.json at runtime, so the version is injected
 * instead of written out by hand — a hardcoded number quietly kept claiming an
 * old release long after the app had moved on.
 */
declare const __APP_VERSION__: string;
