import { describe, expect, it, vi } from "vitest";
const { tintBitmap, ApplicationIconService } = require("../electron/services/application-icon.cjs");

describe("application accent icons", () => {
  it("changes hue while preserving shading, transparency and premultiplied edges", () => {
    const bitmap = Buffer.from([40, 140, 90, 255, 20, 70, 45, 128, 0, 0, 0, 0, 255, 255, 255, 255]);
    const red = tintBitmap(bitmap, "#ff0000");
    const blue = tintBitmap(bitmap, "#0000ff");
    expect(red[2]).toBeGreaterThan(red[0]);
    expect(blue[0]).toBeGreaterThan(blue[2]);
    for (const output of [red, blue]) {
      expect([output[3], output[7], output[11], output[15]]).toEqual([255, 128, 0, 255]);
      expect(output.subarray(8, 12)).toEqual(bitmap.subarray(8, 12));
      expect(output.subarray(12, 16)).toEqual(bitmap.subarray(12, 16));
      for (let index = 4; index < 7; index++) expect(output[index]).toBeLessThanOrEqual(128);
      const light = (data: Buffer, index: number) => .3 * data[index + 2] + .59 * data[index + 1] + .11 * data[index];
      expect(Math.abs(light(output, 0) - light(bitmap, 0))).toBeLessThan(1);
    }
    expect(tintBitmap(bitmap, "not-a-color")).toEqual(tintBitmap(bitmap, "#88c0d0"));
    expect(bitmap[0]).toBe(40);
  });
  it("updates the macOS dock and caches only a bounded set of colors", () => {
    const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.from([40, 140, 90, 255]) };
    const native = { createFromPath: vi.fn(() => image), createFromBitmap: vi.fn(() => image) };
    const dock = { setIcon: vi.fn() };
    const service = new ApplicationIconService(native, { dock }, { getAllWindows: () => [] }, "logo.png", "", "darwin");
    service.apply("#ff0000"); service.apply("#ff0000");
    expect(native.createFromBitmap).toHaveBeenCalledOnce(); expect(dock.setIcon).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 30; index++) service.get(`#${index.toString(16).padStart(6, "0")}`);
    expect(service.cache.size).toBe(8);
  });
});
