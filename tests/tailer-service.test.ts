import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TailerService } = require("../electron/services/tailer-service.cjs");

let root: string;
let file: string;
let service: InstanceType<typeof TailerService>;
let events: Array<{ channel: string; payload: { lines?: string[]; available?: boolean } }>;
const lines = () => events.filter((event) => event.channel === "tailer:lines").flatMap((event) => event.payload.lines || []);

beforeEach(() => {
  vi.useFakeTimers();
  root = fs.mkdtempSync(path.join(process.cwd(), ".kiwi-tailer-test-"));
  file = path.join(root, "server.log");
  events = [];
  service = new TailerService({ assertAllowed: (candidate: string) => candidate },
    (channel: string, payload: { lines?: string[]; available?: boolean }) => events.push({ channel, payload }));
});

afterEach(() => {
  service.stop();
  vi.useRealTimers();
  for (const entry of fs.readdirSync(root)) fs.unlinkSync(path.join(root, entry));
  fs.rmdirSync(root);
});

describe("following a log file", () => {
  it("loads only the requested tail and follows complete appended UTF-8 lines", () => {
    fs.writeFileSync(file, "old\nfirst\nsecond\n");
    service.open(file, { lastLines: 2 });
    expect(lines()).toEqual(["first", "second"]);
    const appended = Buffer.from("grüße\n", "utf8");
    fs.appendFileSync(file, appended.subarray(0, 3));
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["first", "second"]);
    fs.appendFileSync(file, appended.subarray(3));
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["first", "second", "grüße"]);
  });

  it("allows rotation on Windows and reads a larger replacement from the start", () => {
    fs.writeFileSync(file, "old\n");
    service.open(file);
    fs.renameSync(file, `${file}.1`);
    fs.writeFileSync(file, "replacement line one\nreplacement line two\n");
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["old", "replacement line one", "replacement line two"]);
    expect(events.filter((event) => event.channel === "tailer:reset")).toHaveLength(2);
  });

  it("resets partial lines when the file is truncated", () => {
    fs.writeFileSync(file, "old line\npartial unfinished line");
    service.open(file);
    fs.writeFileSync(file, "new\n");
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["old line", "new"]);
  });

  it("waits for a missing file and resumes when it returns", () => {
    service.open(file);
    expect(events.at(-1)?.payload.available).toBe(false);
    fs.writeFileSync(file, "created later\n");
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["created later"]);
    fs.unlinkSync(file);
    vi.advanceTimersByTime(150);
    expect(events.at(-1)?.payload.available).toBe(false);
    fs.writeFileSync(file, "after replacement\n");
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["created later", "after replacement"]);
  });

  it("can follow only future output and stops polling when closed", () => {
    fs.writeFileSync(file, "existing\n");
    service.open(file, { lastLines: 0 });
    expect(lines()).toEqual([]);
    fs.appendFileSync(file, "new\n");
    vi.advanceTimersByTime(150);
    expect(lines()).toEqual(["new"]);
    service.stop();
    fs.appendFileSync(file, "after close\n");
    vi.advanceTimersByTime(300);
    expect(lines()).toEqual(["new"]);
  });
});
