import { describe, expect, it } from "vitest";
import {
  describeUnsentWork,
  stillPending,
  verdictOnReturn,
  worthKeeping,
  type UnsentWork,
} from "../src/collaboration/unsent-work";

const kept: UnsentWork = { path: "src/A.java", text: "class A { int x; }", version: 7, at: 1_000 };

/**
 * A dropped connection threw the buffer away: the file closed and whatever had
 * been typed but not saved to the host was gone with no way back.
 */
describe("what is worth keeping through a disconnect", () => {
  it("keeps a buffer that differs from the host's", () => {
    expect(worthKeeping("src/A.java", "neu", "alt")).toBe(true);
  });

  it("keeps nothing when the host already has it", () => {
    // Offering it back would be a question about nothing.
    expect(worthKeeping("src/A.java", "gleich", "gleich")).toBe(false);
  });

  it("keeps nothing without a file", () => {
    expect(worthKeeping("", "neu", "alt")).toBe(false);
    expect(worthKeeping("   ", "neu", "alt")).toBe(false);
  });
});

/**
 * Re-applying a stale buffer over a file the host has since changed loses
 * somebody else's work instead of your own, which is worse than the problem.
 */
describe("what became of it while the guest was away", () => {
  it("says nothing when the edit got through before the line went", () => {
    expect(verdictOnReturn(kept, { text: kept.text, version: 9 })).toBe("arrived");
  });

  it("offers it back when nothing touched the file", () => {
    expect(verdictOnReturn(kept, { text: "class A { }", version: 7 })).toBe("restorable");
  });

  it("calls it a conflict when somebody else changed the file", () => {
    expect(verdictOnReturn(kept, { text: "class A { int y; }", version: 8 })).toBe("conflict");
  });

  it("answers nothing when there is nothing kept", () => {
    expect(verdictOnReturn(null, { text: "x", version: 1 })).toBe("");
    expect(verdictOnReturn({ ...kept, path: "" }, { text: "x", version: 1 })).toBe("");
  });
});

describe("what the guest is told", () => {
  it("names the file and says whether it moved", () => {
    expect(describeUnsentWork(kept, "restorable")).toBe(
      "Ungesendete Änderungen an A.java von vorhin. Die Datei ist unverändert.");
    expect(describeUnsentWork(kept, "conflict")).toContain("von jemand anderem geändert");
  });

  it("says nothing when there is nothing to say", () => {
    expect(describeUnsentWork(kept, "arrived")).toBe("");
    expect(describeUnsentWork(null, "restorable")).toBe("");
  });
});

describe("when kept work stops being pending", () => {
  it("survives opening a different file", () => {
    // Somebody may well go back to it.
    expect(stillPending(kept, "irgendwas", "src/B.java")).toBe(true);
  });

  it("is done once the host has the same text", () => {
    expect(stillPending(kept, kept.text, "src/A.java")).toBe(false);
  });

  it("is nothing when nothing was kept", () => {
    expect(stillPending(null, "x", "src/A.java")).toBe(false);
  });
});
