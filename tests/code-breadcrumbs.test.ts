import { describe, expect, it } from "vitest";
import { relativePathBreadcrumbs, enclosingCodeSymbol } from "../src/language/code-breadcrumbs";

describe("code breadcrumbs", () => {
  it("splits relative path into hierarchical breadcrumb segments", () => {
    const segments = relativePathBreadcrumbs("src/components/WebPreviewPanel.tsx");
    expect(segments).toEqual([
      { label: "src", kind: "folder", path: "src" },
      { label: "components", kind: "folder", path: "src/components" },
      { label: "WebPreviewPanel.tsx", kind: "file", path: "src/components/WebPreviewPanel.tsx" },
    ]);
  });

  it("handles windows-style backslashes", () => {
    const segments = relativePathBreadcrumbs("src\\workbench\\panel-docks.ts");
    expect(segments).toEqual([
      { label: "src", kind: "folder", path: "src" },
      { label: "workbench", kind: "folder", path: "src/workbench" },
      { label: "panel-docks.ts", kind: "file", path: "src/workbench/panel-docks.ts" },
    ]);
  });

  it("detects TypeScript function and interface enclosing symbols", () => {
    const tsCode = [
      "export interface UserProps {",
      "  name: string;",
      "}",
      "",
      "export function renderUser(props: UserProps) {",
      "  const greeting = 'hello';",
      "  return greeting + props.name;",
      "}",
    ].join("\n");

    const symbolInIface = enclosingCodeSymbol(tsCode, 2, "typescript");
    expect(symbolInIface?.name).toBe("UserProps");

    const symbolInFn = enclosingCodeSymbol(tsCode, 6, "typescript");
    expect(symbolInFn?.name).toBe("renderUser()");
  });

  it("detects Python def and class enclosing symbols", () => {
    const pyCode = [
      "class ServerManager:",
      "    def start_server(self, port=8000):",
      "        print(f'Starting on {port}')",
      "        return True",
    ].join("\n");

    const symbolInMethod = enclosingCodeSymbol(pyCode, 3, "python");
    expect(symbolInMethod?.name).toBe("start_server()");
  });

  it("detects React TSX function components and FC arrows", () => {
    const tsxCode = [
      "import React from 'react';",
      "",
      "export const UserCard: React.FC<{ name: string }> = ({ name }) => {",
      "  return <div className=\"user-card\">{name}</div>;",
      "};",
      "",
      "export function HeaderBanner() {",
      "  return <header>Kiwi IDE</header>;",
      "}",
    ].join("\n");

    const fcSymbol = enclosingCodeSymbol(tsxCode, 4, "typescriptreact");
    expect(fcSymbol?.name).toBe("<UserCard />");
    expect(fcSymbol?.kind).toBe("function");

    const fnSymbol = enclosingCodeSymbol(tsxCode, 8, "typescriptreact");
    expect(fnSymbol?.name).toBe("HeaderBanner()");
  });
});
