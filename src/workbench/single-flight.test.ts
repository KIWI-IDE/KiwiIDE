import { describe, expect, it, vi } from "vitest";
import { runSingleFlight } from "./single-flight";

describe("runSingleFlight", () => {
  it("shares one pending action across repeated shortcut invocations", async () => {
    const state = { current: null as Promise<string> | null };
    let finish!: (value: string) => void;
    const transfer = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));

    const first = runSingleFlight(state, transfer);
    const retry = runSingleFlight(state, transfer);

    expect(retry).toBe(first);
    await Promise.resolve();
    expect(transfer).toHaveBeenCalledTimes(1);

    finish("copied");
    await expect(Promise.all([first, retry])).resolves.toEqual(["copied", "copied"]);
    expect(state.current).toBeNull();

    await expect(runSingleFlight(state, () => "copied again")).resolves.toBe("copied again");
  });

  it("opens the gate again after a failed action", async () => {
    const state = { current: null as Promise<void> | null };

    await expect(runSingleFlight(state, () => Promise.reject(new Error("failed")))).rejects.toThrow("failed");
    expect(state.current).toBeNull();
  });
});
