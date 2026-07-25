export type LocalEvent =
  | { type: "create" | "modify" | "delete"; path: string; at: number }
  | { type: "rename"; path: string; oldPath: string; at: number };

export class EventQueue {
  private readonly events = new Map<string, LocalEvent>();

  enqueue(event: LocalEvent): void {
    const prior = this.events.get(event.path);
    if (prior?.type === "create" && event.type === "modify") return;
    if (prior?.type === "create" && event.type === "delete") {
      this.events.delete(event.path);
      return;
    }
    if (event.type === "rename") this.events.delete(event.oldPath);
    this.events.set(event.path, event);
  }

  drain(): LocalEvent[] {
    const drained = [...this.events.values()].sort(
      (a, b) => a.at - b.at || a.path.localeCompare(b.path),
    );
    this.events.clear();
    return drained;
  }

  peek(): LocalEvent[] {
    return [...this.events.values()].sort((a, b) => a.at - b.at || a.path.localeCompare(b.path));
  }

  get size(): number {
    return this.events.size;
  }
}
