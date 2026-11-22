import { describe, expect, it, vi } from "vitest";
const { revealStartupWindow } = require("../electron/services/startup-window.cjs");
describe("startup readiness", () => {
  it("shows the window before a background task starts or finishes", async () => {
    const order: string[] = [];
    const queued: Array<() => void> = [];
    const window = { isDestroyed: () => false, show: () => order.push("shown") };
    const splash = { isDestroyed: () => false, destroy: () => order.push("splash closed") };
    const background = () => { order.push("warming"); return new Promise(() => undefined); };
    revealStartupWindow({ window, splash, startedAt: 0, now: () => 1, background, schedule: (fn: () => void) => queued.push(fn) });
    expect(order).toEqual(["shown", "splash closed"]);
    queued[0](); await Promise.resolve();
    expect(order).toEqual(["shown", "splash closed", "warming"]);
  });
  it("honors an explicit preview minimum without waiting for background work", () => {
    const show = vi.fn(); const schedule = vi.fn();
    revealStartupWindow({ window: { isDestroyed: () => false, show }, startedAt: 0, minimumMs: 3000, now: () => 500, schedule });
    expect(show).not.toHaveBeenCalled();
    expect(schedule.mock.calls[0][1]).toBe(2500);
    schedule.mock.calls[0][0](); expect(show).toHaveBeenCalledOnce();
  });
});
