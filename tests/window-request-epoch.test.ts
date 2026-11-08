import { describe, expect, it } from "vitest";
import { WindowRequestEpoch, normalizeWindowProjectRoot } from "../src/components/window-request-epoch";

describe("reusable window request epochs", () => {
  it("rejects results from the previous project after a context switch", () => {
    const requests = new WindowRequestEpoch("C:\\work\\alpha");
    const alpha = requests.begin("C:\\work\\alpha");
    const beta = requests.begin("C:\\work\\beta");

    expect(requests.isCurrent(alpha)).toBe(false);
    expect(requests.isCurrent(beta)).toBe(true);
    expect(requests.matchesRoot("C:\\WORK\\BETA\\")).toBe(true);
  });

  it("also invalidates an older refresh for the same project", () => {
    const requests = new WindowRequestEpoch();
    const first = requests.begin("D:\\demo");
    const second = requests.begin("D:\\demo");

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it("invalidates pending work when a window unmounts", () => {
    const requests = new WindowRequestEpoch();
    const pending = requests.begin("D:\\demo");
    requests.invalidate();

    expect(requests.isCurrent(pending)).toBe(false);
  });

  it("normalizes Windows roots without confusing sibling paths", () => {
    expect(normalizeWindowProjectRoot(" C:\\Work\\Demo\\ ")).toBe("c:\\work\\demo");
    expect(normalizeWindowProjectRoot("C:\\Work\\Demo-2")).not.toBe(normalizeWindowProjectRoot("C:\\Work\\Demo"));
  });
});
