export type WindowRequestToken = Readonly<{
  epoch: number;
  rootKey: string;
}>;

export function normalizeWindowProjectRoot(root: string) {
  return root.trim().replace(/[\\/]+$/, "").toLocaleLowerCase();
}

/**
 * Guards async reads in reusable BrowserWindows. Electron can send a new
 * project context while requests for the previous root are still in flight;
 * only the most recent token is allowed to update the React state.
 */
export class WindowRequestEpoch {
  private epoch = 0;
  private rootKey: string;

  constructor(root = "") {
    this.rootKey = normalizeWindowProjectRoot(root);
  }

  begin(root: string): WindowRequestToken {
    this.rootKey = normalizeWindowProjectRoot(root);
    this.epoch += 1;
    return Object.freeze({ epoch: this.epoch, rootKey: this.rootKey });
  }

  invalidate() {
    this.epoch += 1;
  }

  capture(): WindowRequestToken {
    return Object.freeze({ epoch: this.epoch, rootKey: this.rootKey });
  }

  isCurrent(token: WindowRequestToken) {
    return token.epoch === this.epoch && token.rootKey === this.rootKey;
  }

  matchesRoot(root: string) {
    return normalizeWindowProjectRoot(root) === this.rootKey;
  }
}
