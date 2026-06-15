"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CompareBounds } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface UseSplitOptions {
  controlledSplit?: number;
  defaultSplit: number;
  onSplitChange?: (pct: number) => void;
  bounds: CompareBounds;
  containerRef: RefObject<HTMLDivElement | null>;
  widthRef: RefObject<DOMRect | null>;
}

interface UseSplitResult {
  split: number;
  isDragging: boolean;
  controlled: boolean;
  beginDrag: (clientX: number) => void;
  drag: (clientX: number) => void;
  endDrag: () => void;
  nudge: (delta: number) => void;
}

/**
 * Drag/keyboard split logic with the CSS-variable hot path.
 *
 * During a drag we write ONLY `--split` on the container ref (no setState), so
 * neither the layers nor the handle re-render per frame — CSS `calc()` derives
 * both from `var(--split)`. The committed value is pushed to React state on
 * `pointerup`; keyboard nudges commit immediately (low frequency).
 */
export function useSplit(options: UseSplitOptions): UseSplitResult {
  const { bounds, containerRef, widthRef } = options;
  const { min, max } = bounds;

  const controlled = options.controlledSplit !== undefined;
  const [uncontrolledSplit, setUncontrolledSplit] = useState(() =>
    clamp(options.defaultSplit, min, max),
  );

  const split = controlled
    ? clamp(options.controlledSplit as number, min, max)
    : uncontrolledSplit;

  const [isDragging, setIsDragging] = useState(false);

  // Transient live value during a gesture; never triggers a render.
  const liveRef = useRef(split);
  // Mirror committed split for stable keyboard handlers.
  const splitRef = useRef(split);
  splitRef.current = split;

  // Mirror onSplitChange so actions stay referentially stable.
  const onSplitChangeRef = useRef(options.onSplitChange);
  onSplitChangeRef.current = options.onSplitChange;

  const controlledRef = useRef(controlled);
  controlledRef.current = controlled;

  // rAF throttle for controlled mode (host owns per-frame render cost).
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef(split);

  const flushControlled = useCallback((pct: number) => {
    pendingRef.current = pct;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onSplitChangeRef.current?.(pendingRef.current);
    });
  }, []);

  const writeVar = useCallback(
    (pct: number) => {
      containerRef.current?.style.setProperty("--split", String(pct));
    },
    [containerRef],
  );

  const pctFromClientX = useCallback(
    (clientX: number, rect: DOMRect): number =>
      clamp(((clientX - rect.left) / rect.width) * 100, min, max),
    [min, max],
  );

  const beginDrag = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      widthRef.current = rect;
      setIsDragging(true);
      const pct = pctFromClientX(clientX, rect);
      liveRef.current = pct;
      writeVar(pct);
      if (controlledRef.current) flushControlled(pct);
    },
    [containerRef, widthRef, pctFromClientX, writeVar, flushControlled],
  );

  const drag = useCallback(
    (clientX: number) => {
      const rect = widthRef.current;
      if (!rect) return;
      const pct = pctFromClientX(clientX, rect);
      liveRef.current = pct;
      writeVar(pct);
      if (controlledRef.current) flushControlled(pct);
    },
    [widthRef, pctFromClientX, writeVar, flushControlled],
  );

  const endDrag = useCallback(() => {
    setIsDragging(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pct = liveRef.current;
    if (!controlledRef.current) setUncontrolledSplit(pct);
    onSplitChangeRef.current?.(pct);
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      const next = clamp(splitRef.current + delta, min, max);
      if (next === splitRef.current) return;
      liveRef.current = next;
      writeVar(next);
      if (!controlledRef.current) setUncontrolledSplit(next);
      onSplitChangeRef.current?.(next);
    },
    [min, max, writeVar],
  );

  // Resource cleanup only (not state sync): cancel a pending frame on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    split,
    isDragging,
    controlled,
    beginDrag,
    drag,
    endDrag,
    nudge,
  };
}
