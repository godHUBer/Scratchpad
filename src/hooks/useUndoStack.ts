import { useCallback, useRef, useState } from 'react';

export interface UndoableAction {
  label: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

const MAX_STACK = 50;

/**
 * Local undo/redo for canvas actions the current user performed. Remote edits
 * are separate state and are deliberately not undoable.
 */
export function useUndoStack() {
  const undoStack = useRef<UndoableAction[]>([]);
  const redoStack = useRef<UndoableAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncing = useRef(false);

  const sync = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    queueMicrotask(() => {
      setCanUndo(undoStack.current.length > 0);
      setCanRedo(redoStack.current.length > 0);
      syncing.current = false;
    });
  }, []);

  const push = useCallback(
    (action: UndoableAction) => {
      undoStack.current = [...undoStack.current.slice(-(MAX_STACK - 1)), action];
      redoStack.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(async () => {
    const action = undoStack.current.pop();
    if (!action) return;
    await action.undo();
    redoStack.current.push(action);
    sync();
  }, [sync]);

  const redo = useCallback(async () => {
    const action = redoStack.current.pop();
    if (!action) return;
    await action.redo();
    undoStack.current.push(action);
    sync();
  }, [sync]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    sync();
  }, [sync]);

  return { push, undo, redo, clear, canUndo, canRedo };
}
