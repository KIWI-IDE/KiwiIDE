import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeployDialog } from "../src/components/DeployDialog";
import type { DeployTarget } from "../src/types";

// Exercise the dialog's actual event handlers without introducing a DOM test
// dependency. State and refs survive explicit renders, as they do in React.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: () => undefined,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = initial;
      return [hooks.states[index], (next: unknown) => {
        hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      return hooks.refs[index] ||= { current: initial };
    },
  };
});

type ElementProps = {
  children?: ReactNode;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  value?: string;
  onClick?: () => void;
  onBlur?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
};

function elements(node: ReactNode): Array<ReactElement<ElementProps>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

const root = "C:\\project";
const target: DeployTarget = {
  host: "old.example", user: "robin", port: 22, artifact: "build/cloud.jar",
  remoteDirectory: "/opt/cloud", restartCommand: "systemctl --user restart cloud",
};

function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return elements(DeployDialog({ workspaceRoot: root, onClose: () => undefined }));
}

function button(tree = render()) {
  return tree.find((element) => element.props.className === "primary-button")!;
}

function serverInput(tree = render()) {
  return tree.find((element) => element.type === "input" && element.props.placeholder === "cloud.beispiel.de")!;
}

const deploy = {
  save: vi.fn(async (_root: string, next: DeployTarget) => next),
  run: vi.fn(async (_root: string) => ({ ok: true, problem: "", restarted: true })),
};

beforeEach(() => {
  hooks.states = [{ ...target }];
  hooks.refs = [];
  deploy.save.mockReset().mockImplementation(async (_root, next) => next);
  deploy.run.mockReset().mockResolvedValue({ ok: true, problem: "", restarted: true });
  vi.stubGlobal("window", { kiwi: { deploy } });
});

afterEach(() => vi.unstubAllGlobals());

describe("deploy dialog start", () => {
  it("shows a save failure and never starts with the previously saved target", async () => {
    deploy.save.mockRejectedValueOnce(new Error("Speichern fehlgeschlagen"));
    button().props.onClick!();

    await vi.waitFor(() => {
      expect(render().some((element) => element.type === "span"
        && element.props.children === "Speichern fehlgeschlagen")).toBe(true);
    });
    expect(deploy.run).not.toHaveBeenCalled();
    expect(button().props.disabled).toBe(false);

    // The failed save must also release the start guard for a later retry.
    button().props.onClick!();
    await vi.waitFor(() => expect(deploy.run).toHaveBeenCalledTimes(1));
    expect(deploy.run).toHaveBeenCalledWith(root);
  });

  it("waits for saving, disables edits immediately and ignores a second click", async () => {
    let finishSave!: (next: DeployTarget) => void;
    deploy.save.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const start = button();
    start.props.onClick!();
    start.props.onClick!();

    expect(button().props.disabled).toBe(true);
    expect(render().filter((element) => element.type === "input").every((element) => element.props.disabled)).toBe(true);
    await vi.waitFor(() => expect(deploy.save).toHaveBeenCalledTimes(1));
    expect(deploy.run).not.toHaveBeenCalled();

    finishSave(target);
    await vi.waitFor(() => expect(deploy.run).toHaveBeenCalledTimes(1));
    expect(deploy.run).toHaveBeenCalledWith(root);
    expect(deploy.save).toHaveBeenCalledTimes(1);
  });

  it("finishes an older blur save before persisting and deploying the latest edit", async () => {
    let finishBlur!: (next: DeployTarget) => void;
    deploy.save.mockImplementationOnce(() => new Promise((resolve) => { finishBlur = resolve; }));
    serverInput().props.onBlur!();
    await vi.waitFor(() => expect(deploy.save).toHaveBeenCalledTimes(1));

    serverInput().props.onChange!({ target: { value: "new.example" } });
    button().props.onClick!();
    expect(deploy.save).toHaveBeenCalledTimes(1);
    expect(deploy.run).not.toHaveBeenCalled();

    finishBlur(target);
    await vi.waitFor(() => expect(deploy.run).toHaveBeenCalledTimes(1));
    expect(deploy.save).toHaveBeenNthCalledWith(2, root, { ...target, host: "new.example" });
    expect(deploy.save.mock.invocationCallOrder[1]).toBeLessThan(deploy.run.mock.invocationCallOrder[0]);
    expect(serverInput().props.value).toBe("new.example");
  });
});
