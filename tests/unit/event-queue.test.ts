import { describe, expect, it } from "vitest";
import { EventQueue } from "../../src/local/event-queue";

describe("local event queue", () => {
  it("coalesces create plus modify", () => {
    const queue = new EventQueue();
    queue.enqueue({ type: "create", path: "a.md", at: 1 });
    queue.enqueue({ type: "modify", path: "a.md", at: 2 });
    expect(queue.drain()).toEqual([{ type: "create", path: "a.md", at: 1 }]);
  });

  it("drops create plus delete", () => {
    const queue = new EventQueue();
    queue.enqueue({ type: "create", path: "a.md", at: 1 });
    queue.enqueue({ type: "delete", path: "a.md", at: 2 });
    expect(queue.size).toBe(0);
  });

  it("preserves rename context", () => {
    const queue = new EventQueue();
    queue.enqueue({ type: "modify", path: "old.md", at: 1 });
    queue.enqueue({ type: "rename", oldPath: "old.md", path: "new.md", at: 2 });
    expect(queue.drain()).toEqual([{ type: "rename", oldPath: "old.md", path: "new.md", at: 2 }]);
  });
});
