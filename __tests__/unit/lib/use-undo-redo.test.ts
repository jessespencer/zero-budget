import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useUndoRedo, __resetUndoRedo, type UndoRedoError } from "@/lib/use-undo-redo";

afterEach(() => {
  // The stack is a module singleton shared by every consumer, so clear it
  // between tests rather than letting one test's entries leak into the next.
  // Reset outright rather than draining via undo(): an entry whose backward()
  // always throws is restored to the stack on every attempt, so a drain loop
  // would never terminate.
  __resetUndoRedo();
  cleanup();
});

// A mutation whose forward/backward just record that they ran, so a test can
// assert which entry was undone rather than inspecting side effects.
function trackedEntry(label: string, log: string[]) {
  return {
    label,
    forward: async () => {
      log.push(`forward:${label}`);
    },
    backward: async () => {
      log.push(`backward:${label}`);
    },
  };
}

describe("useUndoRedo", () => {
  it("undo() pops the most recent entry", async () => {
    const log: string[] = [];
    const { result } = renderHook(() => useUndoRedo());

    act(() => {
      result.current.push(trackedEntry("a", log));
      result.current.push(trackedEntry("b", log));
    });
    await act(async () => result.current.undo());

    expect(log).toEqual(["backward:b"]);
  });

  it("undoEntry() undoes its own entry, not whatever is on top", async () => {
    // The toast case: the user deletes row A, deletes row B, then clicks the
    // Undo on A's toast while it is still on screen. Popping the stack would
    // restore B and leave A deleted with its toast gone.
    const log: string[] = [];
    const { result } = renderHook(() => useUndoRedo());

    let idA = "";
    act(() => {
      idA = result.current.push(trackedEntry("a", log));
      result.current.push(trackedEntry("b", log));
    });
    await act(async () => result.current.undoEntry(idA));

    expect(log).toEqual(["backward:a"]);
    // b is untouched and still undoable.
    expect(result.current.canUndo).toBe(true);
  });

  it("undoEntry() moves the entry to the redo stack", async () => {
    // Calling backward() directly — what the toasts used to do — left the entry
    // sitting on the undo stack: redo stayed empty and a following Cmd+Z re-ran
    // the same undo.
    const log: string[] = [];
    const { result } = renderHook(() => useUndoRedo());

    let id = "";
    act(() => {
      id = result.current.push(trackedEntry("a", log));
    });
    await act(async () => result.current.undoEntry(id));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(async () => result.current.redo());
    expect(log).toEqual(["backward:a", "forward:a"]);
  });

  // A mutation whose forward or backward rejects, to exercise the recovery
  // path. Before it was added, a rejected closure was an unhandled rejection
  // and the entry vanished from both stacks.
  function failingEntry(label: string, which: "forward" | "backward") {
    return {
      label,
      forward: async () => {
        if (which === "forward") throw new Error(`${label} forward boom`);
      },
      backward: async () => {
        if (which === "backward") throw new Error(`${label} backward boom`);
      },
    };
  }

  it("keeps the entry undoable when backward() throws", async () => {
    // The undo didn't happen, so the entry must stay on the undo stack (a
    // retry can try again) rather than disappear from both stacks.
    const { result } = renderHook(() => useUndoRedo());

    act(() => {
      result.current.push(failingEntry("a", "backward"));
    });
    await act(async () => result.current.undo());

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("reports a failed undo through onError", async () => {
    const errors: UndoRedoError[] = [];
    const { result } = renderHook(() =>
      useUndoRedo({ onError: (info) => errors.push(info) })
    );

    let id = "";
    act(() => {
      id = result.current.push(failingEntry("a", "backward"));
    });
    await act(async () => result.current.undoEntry(id));

    expect(errors).toHaveLength(1);
    expect(errors[0].action).toBe("undo");
    expect(errors[0].label).toBe("a");
    // Still recoverable.
    expect(result.current.canUndo).toBe(true);
  });

  it("keeps the entry redoable when forward() throws, and reports it", async () => {
    const errors: UndoRedoError[] = [];
    const { result } = renderHook(() =>
      useUndoRedo({ onError: (info) => errors.push(info) })
    );

    act(() => {
      result.current.push(failingEntry("a", "forward"));
    });
    // backward() succeeds, so the undo moves it to the redo stack.
    await act(async () => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    // forward() throws: it must stay redoable, not move back to undo.
    await act(async () => result.current.redo());
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
    expect(errors.map((e) => e.action)).toEqual(["redo"]);
  });

  it("undoEntry() is inert once the entry is gone", async () => {
    // A toast can outlive its entry — Cmd+Z already consumed it, or a later
    // push cleared the redo stack. Clicking Undo then must do nothing rather
    // than undo an unrelated action.
    const log: string[] = [];
    const { result } = renderHook(() => useUndoRedo());

    let id = "";
    act(() => {
      id = result.current.push(trackedEntry("a", log));
    });
    await act(async () => result.current.undo()); // consumed by Cmd+Z
    await act(async () => result.current.undoEntry(id)); // stale toast click

    expect(log).toEqual(["backward:a"]);
  });
});
