import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoCollapse } from "@/components/shared/use-auto-collapse";

// A controllable matchMedia: one shared "narrow" flag plus the listeners the
// hook registers, so a test can cross the breakpoint the way a resize would.
function stubViewport(initiallyNarrow: boolean) {
  let narrow = initiallyNarrow;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return narrow;
    },
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  }));
  return (nextNarrow: boolean) => {
    narrow = nextNarrow;
    act(() => listeners.forEach((l) => l({ matches: nextNarrow } as MediaQueryListEvent)));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAutoCollapse", () => {
  it("starts expanded on a wide screen and collapsed on a narrow one", () => {
    stubViewport(false);
    expect(renderHook(() => useAutoCollapse()).result.current[0]).toBe(false);

    stubViewport(true);
    expect(renderHook(() => useAutoCollapse()).result.current[0]).toBe(true);
  });

  it("collapses when the window narrows and re-expands when it widens", () => {
    const resize = stubViewport(false);
    const { result } = renderHook(() => useAutoCollapse());

    resize(true);
    expect(result.current[0]).toBe(true);
    resize(false);
    expect(result.current[0]).toBe(false);
  });

  it("keeps a wide-screen collapse when the window narrows and widens again", () => {
    const resize = stubViewport(false);
    const { result } = renderHook(() => useAutoCollapse());

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    resize(true);
    resize(false);
    expect(result.current[0]).toBe(true);
  });

  it("lets a narrow screen expand by hand without changing the wide-screen choice", () => {
    const resize = stubViewport(true);
    const { result } = renderHook(() => useAutoCollapse());

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    resize(false);
    resize(true);
    expect(result.current[0]).toBe(true);
  });
});
