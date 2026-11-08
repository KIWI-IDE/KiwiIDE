import { lazy, Suspense } from "react";
import { t } from "../i18n";

const TerminalScreen = lazy(() => import("./TerminalScreen").then((module) => ({
  default: module.TerminalScreen,
})));

export function LazyTerminalScreen(props: {
  output: string;
  fontSize?: number;
  transparent?: boolean;
  background?: string;
  foreground?: string;
  onData?: (data: string) => void;
  onResize?: (columns: number, rows: number) => void;
  autoFocus?: boolean;
}) {
  return (
    <Suspense fallback={<div className="terminal-lazy-loading"><span /> {t("Terminal wird geladen …")}</div>}>
      <TerminalScreen {...props} />
    </Suspense>
  );
}
