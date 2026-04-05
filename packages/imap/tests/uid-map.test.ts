import { describe, it, expect } from "vitest";
import { UidMap } from "../src/uid-map.ts";

describe("RFC 3501 Section 2.3.1.1: Unique Identifiers (UIDs)", () => {
  it("assigns UIDs starting from uidNext", () => {
    const map = new UidMap(1, 100);
    const uid = map.addMessage("msg-001");
    expect(uid).toBe(100);
  });

  it("assigns strictly increasing UIDs", () => {
    const map = new UidMap(1, 1);
    const uid1 = map.addMessage("msg-001");
    const uid2 = map.addMessage("msg-002");
    const uid3 = map.addMessage("msg-003");
    expect(uid1).toBe(1);
    expect(uid2).toBe(2);
    expect(uid3).toBe(3);
  });

  it("advances uidNext after each assignment", () => {
    const map = new UidMap(1, 1);
    map.addMessage("msg-001");
    expect(map.uidNext).toBe(2);
    map.addMessage("msg-002");
    expect(map.uidNext).toBe(3);
  });

  it("never reuses UIDs after expunge", () => {
    const map = new UidMap(1, 1);
    const uid1 = map.addMessage("msg-001");
    map.addMessage("msg-002");
    map.expungeUid(uid1);
    const uid3 = map.addMessage("msg-003");
    expect(uid3).toBe(3);
  });

  it("maintains UIDVALIDITY", () => {
    const map = new UidMap(42, 1);
    expect(map.uidValidity).toBe(42);
  });

  it("provides bidirectional UID-to-messageId mapping", () => {
    const map = new UidMap(1, 1);
    const uid = map.addMessage("msg-001");
    expect(map.uidToMessageId(uid)).toBe("msg-001");
    expect(map.messageIdToUid("msg-001")).toBe(uid);
  });

  it("returns undefined for non-existent UIDs", () => {
    const map = new UidMap(1, 1);
    expect(map.uidToMessageId(999)).toBeUndefined();
  });

  it("returns undefined for non-existent message IDs", () => {
    const map = new UidMap(1, 1);
    expect(map.messageIdToUid("nonexistent")).toBeUndefined();
  });
});

describe("RFC 3501 Section 2.3.1.2: Sequence Numbers", () => {
  it("assigns 1-based sequence numbers", () => {
    const map = new UidMap(1, 1);
    const uid1 = map.addMessage("msg-001");
    const uid2 = map.addMessage("msg-002");
    expect(map.uidToSequence(uid1)).toBe(1);
    expect(map.uidToSequence(uid2)).toBe(2);
  });

  it("maps sequence numbers to UIDs", () => {
    const map = new UidMap(1, 1);
    map.addMessage("msg-001");
    const uid2 = map.addMessage("msg-002");
    expect(map.sequenceToUid(2)).toBe(uid2);
  });

  it("returns undefined for out-of-range sequence numbers", () => {
    const map = new UidMap(1, 1);
    map.addMessage("msg-001");
    expect(map.sequenceToUid(0)).toBeUndefined();
    expect(map.sequenceToUid(2)).toBeUndefined();
  });

  it("shifts sequence numbers down after EXPUNGE", () => {
    const map = new UidMap(1, 1);
    const uid1 = map.addMessage("msg-001");
    const uid2 = map.addMessage("msg-002");
    const uid3 = map.addMessage("msg-003");
    map.expungeUid(uid1);
    expect(map.uidToSequence(uid2)).toBe(1);
    expect(map.uidToSequence(uid3)).toBe(2);
    expect(map.totalMessages()).toBe(2);
  });

  it("returns former sequence number from expunge", () => {
    const map = new UidMap(1, 1);
    map.addMessage("msg-001");
    map.addMessage("msg-002");
    const uid3 = map.addMessage("msg-003");
    const formerSeq = map.expungeUid(uid3);
    expect(formerSeq).toBe(3);
  });

  it("throws when expunging non-existent UID", () => {
    const map = new UidMap(1, 1);
    expect(() => map.expungeUid(999)).toThrow("UID 999 not found");
  });

  it("reports total message count", () => {
    const map = new UidMap(1, 1);
    expect(map.totalMessages()).toBe(0);
    map.addMessage("msg-001");
    map.addMessage("msg-002");
    expect(map.totalMessages()).toBe(2);
  });
});

describe("RFC 3501 Section 2.3.1.1: Loading Pre-existing Messages", () => {
  it("loads messages sorted by UID ascending", () => {
    const map = new UidMap(1, 1);
    map.load([
      { uid: 10, messageId: "msg-a" },
      { uid: 20, messageId: "msg-b" },
      { uid: 30, messageId: "msg-c" },
    ]);
    expect(map.totalMessages()).toBe(3);
    expect(map.uidToMessageId(10)).toBe("msg-a");
    expect(map.uidToMessageId(20)).toBe("msg-b");
    expect(map.uidToMessageId(30)).toBe("msg-c");
  });

  it("assigns correct sequence numbers to loaded messages", () => {
    const map = new UidMap(1, 1);
    map.load([
      { uid: 10, messageId: "msg-a" },
      { uid: 20, messageId: "msg-b" },
    ]);
    expect(map.sequenceToUid(1)).toBe(10);
    expect(map.sequenceToUid(2)).toBe(20);
  });

  it("updates uidNext to be greater than highest loaded UID", () => {
    const map = new UidMap(1, 1);
    map.load([
      { uid: 50, messageId: "msg-a" },
      { uid: 100, messageId: "msg-b" },
    ]);
    expect(map.uidNext).toBe(101);
  });

  it("preserves uidNext if higher than loaded UIDs", () => {
    const map = new UidMap(1, 500);
    map.load([{ uid: 10, messageId: "msg-a" }]);
    expect(map.uidNext).toBe(500);
  });

  it("clears previous state on load", () => {
    const map = new UidMap(1, 1);
    map.addMessage("old-msg");
    map.load([{ uid: 1, messageId: "new-msg" }]);
    expect(map.totalMessages()).toBe(1);
    expect(map.uidToMessageId(1)).toBe("new-msg");
    expect(map.messageIdToUid("old-msg")).toBeUndefined();
  });
});

describe("RFC 3501 Section 6.4.8: Sequence Set Resolution", () => {
  function loadedMap(): UidMap {
    const map = new UidMap(1, 1);
    map.load([
      { uid: 10, messageId: "msg-a" },
      { uid: 20, messageId: "msg-b" },
      { uid: 30, messageId: "msg-c" },
      { uid: 40, messageId: "msg-d" },
      { uid: 50, messageId: "msg-e" },
    ]);
    return map;
  }

  it("resolves single sequence number", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 1 }])).toEqual([10]);
  });

  it("resolves sequence range", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 2, end: 4 }])).toEqual([20, 30, 40]);
  });

  it("resolves wildcard (*) as last message", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: "*" }])).toEqual([50]);
  });

  it("resolves range with wildcard end", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 3, end: "*" }])).toEqual([30, 40, 50]);
  });

  it("resolves 1:* as all messages", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 1, end: "*" }])).toEqual([10, 20, 30, 40, 50]);
  });

  it("resolves multiple ranges", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 1 }, { start: 3 }, { start: 5 }])).toEqual([
      10, 30, 50,
    ]);
  });

  it("deduplicates overlapping ranges", () => {
    const map = loadedMap();
    expect(
      map.resolveSequenceSet([
        { start: 1, end: 3 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([10, 20, 30, 40]);
  });

  it("returns empty for out-of-range sequence numbers (Section 6.4.8)", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 100 }])).toEqual([]);
  });

  it("returns empty for empty map", () => {
    const map = new UidMap(1, 1);
    expect(map.resolveSequenceSet([{ start: 1, end: "*" }])).toEqual([]);
  });

  it("handles reversed range (5:3 same as 3:5)", () => {
    const map = loadedMap();
    expect(map.resolveSequenceSet([{ start: 5, end: 3 }])).toEqual([30, 40, 50]);
  });
});

describe("RFC 3501 Section 6.4.8: UID Set Resolution", () => {
  function loadedMap(): UidMap {
    const map = new UidMap(1, 1);
    map.load([
      { uid: 10, messageId: "msg-a" },
      { uid: 20, messageId: "msg-b" },
      { uid: 30, messageId: "msg-c" },
      { uid: 40, messageId: "msg-d" },
      { uid: 50, messageId: "msg-e" },
    ]);
    return map;
  }

  it("resolves single UID", () => {
    const map = loadedMap();
    expect(map.resolveUidSet([{ start: 20 }])).toEqual([20]);
  });

  it("resolves UID range", () => {
    const map = loadedMap();
    expect(map.resolveUidSet([{ start: 20, end: 40 }])).toEqual([20, 30, 40]);
  });

  it("resolves wildcard as highest UID", () => {
    const map = loadedMap();
    expect(map.resolveUidSet([{ start: "*" }])).toEqual([50]);
  });

  it("skips UIDs that do not exist in the map", () => {
    const map = loadedMap();
    expect(map.resolveUidSet([{ start: 15, end: 25 }])).toEqual([20]);
  });

  it("returns empty for non-matching range", () => {
    const map = loadedMap();
    expect(map.resolveUidSet([{ start: 100, end: 200 }])).toEqual([]);
  });

  it("handles reversed UID range (40:20 same as 20:40) (Section 6.4.8)", () => {
    const map = loadedMap();
    expect(map.resolveUidSet([{ start: 40, end: 20 }])).toEqual([20, 30, 40]);
  });
});
