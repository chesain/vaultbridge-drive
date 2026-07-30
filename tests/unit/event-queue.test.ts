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

  it("allows a foreground probe to inspect events without consuming them", () => {
    const queue = new EventQueue();
    const event = { type: "rename", oldPath: "old.md", path: "new.md", at: 2 } as const;
    queue.enqueue(event);

    expect(queue.peek()).toEqual([event]);
    expect(queue.peek()).toEqual([event]);
    expect(queue.drain()).toEqual([event]);
    expect(queue.size).toBe(0);
  });
});
