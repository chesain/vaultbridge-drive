import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncActivationShield } from "../../src/ui/sync-activation-shield";

describe("mobile sync activation shield", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("quietly blocks editing events until the foreground check completes", () => {
    class FakeHTMLElement {
      blur = vi.fn();
      getAttributeNames = (): string[] => [];
      tagName = "DIV";
    }
    vi.stubGlobal("HTMLElement", FakeHTMLElement);

    const attributes = new Map<string, string>();
    const element = Object.assign(new FakeHTMLElement(), {
      className: "",
      remove: vi.fn(),
      setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
    });
    const listeners = new Map<string, EventListener>();
    const document = {
      activeElement: new FakeHTMLElement(),
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => element),
      addEventListener: vi.fn((type: string, listener: EventListener) =>
        listeners.set(type, listener),
      ),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const shield = new SyncActivationShield(document);

    shield.setPhase("downloading", "Applying remote changes");
    shield.open();

    expect(element.className).toBe("vaultbridge-activation-shield");
    expect(attributes.get("aria-label")).toBe("Applying remote changes");
    expect(document.body.appendChild).toHaveBeenCalledOnce();
    expect(listeners.has("beforeinput")).toBe(true);
    expect(listeners.has("pointerdown")).toBe(true);

    const event = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as Event;
    listeners.get("beforeinput")?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();

    shield.complete();
    expect(element.remove).toHaveBeenCalledOnce();
    expect(document.removeEventListener).toHaveBeenCalledTimes(listeners.size);
  });
});
