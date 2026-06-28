"use client";

import { type KeyboardEvent, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  useCompareControl,
  useCompareReveal,
  useCompareState,
} from "./context";
import { injectIntoChild } from "./Slot";
import type {
  HandleProps,
  LabelProps,
  OverlayProps,
  Slot,
  SlotProps,
} from "./types";
import { resolveLoaded } from "./useSlotLoad";

/**
 * Shared load wiring for a slot's <img> (default or asChild). Returns a ref,
 * onLoad, and onError to attach/inject. Handles the cached-image case (img
 * already `complete` before React attaches) via the ref callback, and dedupes
 * load/error so each slot resolves exactly once.
 */
function useSlotWiring(slot: Slot, decode: boolean) {
  // Slots read only the stable control context, so they don't re-render on
  // split/isDragging commits (which would re-rasterize next/image mid-gesture).
  const { actions } = useCompareControl();
  const setStatus = actions.setStatus;

  const imgRef = useRef<HTMLImageElement | null>(null);
  const decodeRef = useRef(decode);
  decodeRef.current = decode;
  const doneRef = useRef(false);

  const markLoaded = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    resolveLoaded(imgRef.current, decodeRef.current).then(() => {
      setStatus(slot, "loaded");
    });
  }, [slot, setStatus]);

  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      if (node?.complete && node.naturalWidth > 0) markLoaded();
    },
    [markLoaded],
  );

  const onLoad = useCallback(() => {
    markLoaded();
  }, [markLoaded]);

  const onError = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setStatus(slot, "error");
  }, [slot, setStatus]);

  return { ref, onLoad, onError };
}

interface SlotImageProps extends SlotProps {
  slot: Slot;
  clip: boolean;
  fetchPriority?: "high" | "low" | "auto";
}

function SlotImage({
  slot,
  clip,
  fetchPriority,
  asChild,
  src,
  alt,
  className,
  decode = true,
  children,
}: SlotImageProps) {
  const wiring = useSlotWiring(slot, decode);
  const layerClass = cn(
    "absolute inset-0 block h-full w-full object-cover",
    // After layer reveal driven entirely by the --split CSS variable. The
    // will-change hint is toggled by the container's `cr-dragging` marker via
    // CSS so the image element never re-renders on drag start/end.
    clip &&
      "[clip-path:inset(0_0_0_calc(var(--split)*1%))] [.cr-dragging_&]:will-change-[clip-path]",
    className,
  );

  if (asChild) {
    return injectIntoChild(children, {
      className: layerClass,
      ref: wiring.ref,
      onLoad: wiring.onLoad,
      onError: wiring.onError,
    });
  }

  if (!src) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `CompareReveal.${slot === "before" ? "Before" : "After"}: no \`src\` and no \`asChild\` child provided.`,
      );
    }
    return null;
  }

  return (
    // biome-ignore lint/performance/noImgElement: default path is an intentional raw <img> (own ref for decode(), fetchPriority); next/image is supported via asChild.
    <img
      ref={wiring.ref}
      src={src}
      alt={alt ?? ""}
      onLoad={wiring.onLoad}
      onError={wiring.onError}
      className={layerClass}
      fetchPriority={fetchPriority}
      decoding="async"
      draggable={false}
    />
  );
}

export function Before(props: SlotProps) {
  return (
    <SlotImage slot="before" clip={false} fetchPriority="high" {...props} />
  );
}

export function After(props: SlotProps) {
  return <SlotImage slot="after" clip {...props} />;
}

export function Handle({
  className,
  children,
  "aria-label": ariaLabel,
}: HandleProps) {
  const { state, actions, meta } = useCompareReveal();
  const canInteract = state.before === "loaded" && state.after === "loaded";
  const { min, max, step } = meta.bounds;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const factor = event.shiftKey ? 5 : 1;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        actions.nudge(-step * factor);
        break;
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        actions.nudge(step * factor);
        break;
      case "Home":
        event.preventDefault();
        actions.nudge(min - state.split);
        break;
      case "End":
        event.preventDefault();
        actions.nudge(max - state.split);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={meta.handleRef}
      role="slider"
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={state.split}
      aria-valuetext={`Before ${state.split}%, After ${100 - state.split}%`}
      aria-label={ariaLabel ?? meta.label ?? "Compare before and after images"}
      aria-disabled={!canInteract}
      tabIndex={canInteract ? 0 : -1}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute top-0 bottom-0 left-[calc(var(--split)*1%)] z-10 flex w-11 -translate-x-1/2 items-center justify-center outline-none",
        canInteract ? "cursor-ew-resize" : "cursor-default",
        className,
      )}
    >
      {children ?? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background/90 shadow-[0_0_4px_rgba(0,0,0,0.45)]"
          />
          <span
            aria-hidden
            className="pointer-events-none relative grid size-9 place-items-center rounded-full bg-background text-foreground shadow-md ring-ring ring-offset-2 ring-offset-background motion-safe:transition-transform group-active:scale-95 group-focus-visible:ring-2"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="presentation"
            >
              <path d="m9 6-4 6 4 6" />
              <path d="m15 6 4 6-4 6" />
            </svg>
          </span>
        </>
      )}
    </div>
  );
}

export function Label({ slot, className, children }: LabelProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-3 z-10 rounded-md bg-foreground/80 px-2 py-1 font-medium text-background text-xs",
        slot === "before" ? "left-3" : "right-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Overlay({
  className,
  loadingContent,
  errorContent,
}: OverlayProps) {
  const state = useCompareState();
  const hasError = state.before === "error" || state.after === "error";
  const canInteract = state.before === "loaded" && state.after === "loaded";

  if (hasError) {
    return (
      <div
        className={cn(
          "absolute inset-0 z-20 grid place-items-center bg-muted text-sm text-muted-foreground",
          className,
        )}
      >
        {errorContent ?? "Failed to load images."}
      </div>
    );
  }

  if (!canInteract) {
    return (
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 z-20 animate-pulse bg-muted",
          className,
        )}
      >
        {loadingContent}
      </div>
    );
  }

  return null;
}
