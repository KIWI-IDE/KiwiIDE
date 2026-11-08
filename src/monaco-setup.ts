import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { loader } from "@monaco-editor/react";

/**
 * Binds the editor to the copy of Monaco that ships with the app.
 *
 * @monaco-editor/react otherwise fetches Monaco from jsDelivr on every start,
 * which is a strange dependency for a desktop IDE that already bundles a JDK
 * and a language server: without a connection the editor simply never appears.
 * It also meant the running version (whatever the CDN served) drifted from the
 * one the code is type-checked against.
 *
 * Web files use Monaco's bundled language services. Their dedicated workers
 * provide HTML/CSS/JSON completion and JavaScript/TypeScript type analysis;
 * returning the base editor worker for these labels silently disables them.
 */
self.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new HtmlWorker();
    if (["typescript", "javascript", "typescriptreact", "javascriptreact"].includes(label)) return new TypeScriptWorker();
    return new EditorWorker();
  },
};

const webCompilerOptions: monaco.languages.typescript.CompilerOptions = {
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  allowNonTsExtensions: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
};
monaco.languages.typescript.typescriptDefaults.setCompilerOptions(webCompilerOptions);
monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ ...webCompilerOptions, checkJs: false });
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

const nodeAmbientDeclarations = `
declare var process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code?: number): void;
  stdout: any;
  stderr: any;
  stdin: any;
  version: string;
  platform: string;
  nextTick(callback: (...args: any[]) => void, ...args: any[]): void;
};
declare var Buffer: {
  from(data: any, encoding?: string): any;
  alloc(size: number, fill?: any): any;
  isBuffer(obj: any): boolean;
  concat(list: any[], totalLength?: number): any;
};
declare function require(moduleName: string): any;
declare var module: { exports: any };
declare var exports: any;
declare var __dirname: string;
declare var __filename: string;
`;

monaco.languages.typescript.typescriptDefaults.addExtraLib(nodeAmbientDeclarations, "ts:node-globals.d.ts");
monaco.languages.typescript.javascriptDefaults.addExtraLib(nodeAmbientDeclarations, "ts:node-globals.d.ts");

const reactAmbientDeclarations = `
declare namespace JSX {
  interface Element {
    type: any;
    props: any;
    key: any;
  }
  interface ElementClass {
    render(): any;
  }
  interface IntrinsicAttributes {
    key?: string | number | null | undefined;
    ref?: any;
  }
  interface HTMLAttributes {
    id?: string;
    className?: string;
    style?: Record<string, any> | string;
    title?: string;
    role?: string;
    tabIndex?: number;
    onClick?: (event: any) => void;
    onChange?: (event: any) => void;
    onSubmit?: (event: any) => void;
    onKeyDown?: (event: any) => void;
    onKeyUp?: (event: any) => void;
    onMouseEnter?: (event: any) => void;
    onMouseLeave?: (event: any) => void;
    children?: any;
    dangerouslySetInnerHTML?: { __html: string };
    [key: string]: any;
  }
  interface IntrinsicElements {
    div: HTMLAttributes;
    span: HTMLAttributes;
    p: HTMLAttributes;
    a: HTMLAttributes & { href?: string; target?: string; rel?: string };
    button: HTMLAttributes & { type?: "button" | "submit" | "reset"; disabled?: boolean };
    input: HTMLAttributes & { type?: string; value?: any; placeholder?: string; disabled?: boolean; checked?: boolean };
    textarea: HTMLAttributes & { value?: string; placeholder?: string; rows?: number; cols?: number };
    select: HTMLAttributes & { value?: any; disabled?: boolean };
    option: HTMLAttributes & { value?: any; selected?: boolean };
    img: HTMLAttributes & { src?: string; alt?: string; width?: number | string; height?: number | string };
    form: HTMLAttributes & { action?: string; method?: string };
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    h4: HTMLAttributes;
    h5: HTMLAttributes;
    h6: HTMLAttributes;
    header: HTMLAttributes;
    footer: HTMLAttributes;
    main: HTMLAttributes;
    nav: HTMLAttributes;
    section: HTMLAttributes;
    article: HTMLAttributes;
    aside: HTMLAttributes;
    ul: HTMLAttributes;
    ol: HTMLAttributes;
    li: HTMLAttributes;
    table: HTMLAttributes;
    tr: HTMLAttributes;
    td: HTMLAttributes;
    th: HTMLAttributes;
    tbody: HTMLAttributes;
    thead: HTMLAttributes;
    label: HTMLAttributes & { htmlFor?: string };
    svg: HTMLAttributes & { width?: any; height?: any; viewBox?: string; fill?: string; stroke?: string };
    path: HTMLAttributes & { d?: string; fill?: string; stroke?: string };
    circle: HTMLAttributes & { cx?: any; cy?: any; r?: any };
    code: HTMLAttributes;
    pre: HTMLAttributes;
    blockquote: HTMLAttributes;
    hr: HTMLAttributes;
    br: HTMLAttributes;
    small: HTMLAttributes;
    strong: HTMLAttributes;
    em: HTMLAttributes;
    i: HTMLAttributes;
    b: HTMLAttributes;
    [elemName: string]: HTMLAttributes;
  }
}

declare module "react" {
  export type ReactNode = any;
  export type CSSProperties = Record<string, any>;
  export interface FC<P = {}> {
    (props: P & { children?: ReactNode }): JSX.Element | null;
    displayName?: string;
  }
  export type FunctionComponent<P = {}> = FC<P>;
  export function createElement(type: any, props?: any, ...children: any[]): JSX.Element;
  export function useState<T>(initialState: T | (() => T)): [T, (action: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useMemo<T>(factory: () => T, deps: any[] | undefined): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T;
  export function useRef<T>(initialValue?: T): { current: T };
  export function useContext<T>(context: any): T;
  export function useReducer<R extends (...args: any[]) => any, I>(reducer: R, initialArg: I, init?: (arg: I) => any): [any, (action: any) => void];
  export const Fragment: any;
  const React: {
    createElement: typeof createElement;
    useState: typeof useState;
    useEffect: typeof useEffect;
    useLayoutEffect: typeof useLayoutEffect;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    useRef: typeof useRef;
    useContext: typeof useContext;
    useReducer: typeof useReducer;
    Fragment: typeof Fragment;
    FC: typeof FC;
    [key: string]: any;
  };
  export default React;
}

declare module "react/jsx-runtime" {
  export function jsx(type: any, props: any, key?: any): JSX.Element;
  export function jsxs(type: any, props: any, key?: any): JSX.Element;
  export const Fragment: any;
}
`;

monaco.languages.typescript.typescriptDefaults.addExtraLib(reactAmbientDeclarations, "ts:react.d.ts");
monaco.languages.typescript.javascriptDefaults.addExtraLib(reactAmbientDeclarations, "ts:react.d.ts");

loader.config({ monaco });

export { monaco };
