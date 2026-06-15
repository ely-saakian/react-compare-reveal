"use client";

import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
} from "react";
import { cn } from "@/lib/utils";
import {
  type CompareControl,
  CompareControlContext,
  CompareStateContext,
} from "./context";
import { After, Before, Handle, Label, Overlay } from "./parts";
import type { CompareRevealProps, CompareState, Slot } from "./types";
import { useSlotLoad } from "./useSlotLoad";
import { useSplit } from "./useSplit";

interface RootProps {
  defaultSplit?: number;
  split?: number;
  onSplitChange?: (pct: number) => void;
  min?: number;
  max?: number;
  keyboardStep?: number;
  aspectRatio?: number | string;
  className?: string;
  label?: string;
  onReady?: () => void;
  onError?: (slot: Slot) => void;
  children?: ReactNode;
}

/**
 * Provider + interactive root box. Owns committed split/load state and the
 * pointer hot path. The split during a drag is written only to the `--split`
 * CSS variable on the container (no setState per frame); CSS `calc()` derives
 * the after-layer clip and the handle position from it.
 */
function CompareRevealRoot({
  defaultSplit = 50,
  split: controlledSplit,
  onSplitChange,
  min = 0,
  max = 100,
  keyboardStep = 1,
  aspectRatio,
  className,
  label,
  onReady,
  onError,
  children,
}: RootProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef<DOMRect | null>(null);

  const bounds = useMemo(
    () => ({ min, max, step: keyboardStep }),
    [min, max, keyboardStep],
  );

  const { split, isDragging, controlled, beginDrag, drag, endDrag, nudge } =
    useSplit({
      controlledSplit,
      defaultSplit,
      onSplitChange,
      bounds,
      containerRef,
      widthRef,
    });

  const { before, after, setStatus } = useSlotLoad({ onReady, onError });

  const canInteract = before === "loaded" && after === "loaded";

  if (process.env.NODE_ENV !== "production") {
    if (controlled && !onSplitChange) {
      console.warn(
        "CompareReveal: `split` was provided without `onSplitChange`. The slider will appear frozen. Provide `onSplitChange` or use `defaultSplit` for uncontrolled mode.",
      );
    }
  }

  // Volatile: changes on every drag commit / load event.
  const stateValue = useMemo<CompareState>(
    () => ({ split, isDragging, before, after }),
    [split, isDragging, before, after],
  );

  // Stable: referentially constant across a gesture, so slot consumers that
  // only read actions/meta don't re-render while dragging.
  const controlValue = useMemo<CompareControl>(
    () => ({
      actions: { beginDrag, drag, endDrag, nudge, setStatus },
      meta: { containerRef, handleRef, widthRef, bounds, controlled, label },
    }),
    [beginDrag, drag, endDrag, nudge, setStatus, bounds, controlled, label],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginDrag(event.clientX);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    event.preventDefault();
    drag(event.clientX);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    endDrag();
  };

  const style = {
    "--split": split,
    aspectRatio,
  } as CSSProperties;

  return (
    <CompareControlContext value={controlValue}>
      <CompareStateContext value={stateValue}>
        <div
          ref={containerRef}
          className={cn(
            "relative isolate overflow-hidden",
            isDragging && "cr-dragging",
            canInteract && "cursor-ew-resize touch-none select-none",
            className,
          )}
          style={style}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {children}
        </div>
      </CompareStateContext>
    </CompareControlContext>
  );
}

function sourceKey(beforeSrc?: string, afterSrc?: string): string {
  return `${beforeSrc ?? ""}|${afterSrc ?? ""}`;
}

/**
 * Public component. Two usage tiers:
 *
 *  - Flat: pass `beforeSrc`/`afterSrc` (+ alts/labels). Built on the compound
 *    API; source changes derive a `key` so the subtree remounts, resetting
 *    split + load state without an effect.
 *  - Compound: pass children (`CompareReveal.Before/.After/.Handle/...`). The
 *    host owns composition (and, if needed, the reset `key`).
 */
function CompareReveal({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  beforeLabel,
  afterLabel,
  defaultSplit,
  split,
  onSplitChange,
  min,
  max,
  keyboardStep,
  aspectRatio,
  className,
  label,
  onReady,
  onError,
  decode,
  children,
}: CompareRevealProps) {
  const rootProps: RootProps = {
    defaultSplit,
    split,
    onSplitChange,
    min,
    max,
    keyboardStep,
    aspectRatio,
    className,
    label,
    onReady,
    onError,
  };

  // Escape hatch: compose the parts explicitly; host owns reset keys.
  if (children) {
    return <CompareRevealRoot {...rootProps}>{children}</CompareRevealRoot>;
  }

  // Flat path: build the compound tree, reset via keyed remount on src change.
  return (
    <CompareRevealRoot key={sourceKey(beforeSrc, afterSrc)} {...rootProps}>
      <Before src={beforeSrc} alt={beforeAlt} decode={decode} />
      <After src={afterSrc} alt={afterAlt} decode={decode} />
      {beforeLabel ? <Label slot="before">{beforeLabel}</Label> : null}
      {afterLabel ? <Label slot="after">{afterLabel}</Label> : null}
      <Handle />
      <Overlay />
    </CompareRevealRoot>
  );
}

const CompareRevealNamespace = Object.assign(CompareReveal, {
  Before,
  After,
  Handle,
  Label,
  Overlay,
});

export { CompareRevealNamespace as CompareReveal };
