import type { ReactNode, RefObject } from "react";

export type LoadStatus = "loading" | "loaded" | "error";
export type Slot = "before" | "after";

/**
 * Committed interaction state. None of these change on the per-frame drag hot
 * path — `split` is only written on `pointerup` / keyboard nudge, and the live
 * drag value lives in a ref + the `--split` CSS variable instead.
 */
export interface CompareState {
  /** Committed value (0–100); NOT updated per drag frame. */
  split: number;
  isDragging: boolean;
  before: LoadStatus;
  after: LoadStatus;
}

export interface CompareActions {
  /** Capture rect → widthRef, start drag, jump to pointer position. */
  beginDrag: (clientX: number) => void;
  /** Imperative: writes `--split` only, no setState. */
  drag: (clientX: number) => void;
  /** Commits live split → state + onSplitChange. */
  endDrag: () => void;
  /** Keyboard: clamps split ± delta and commits immediately. */
  nudge: (delta: number) => void;
  setStatus: (slot: Slot, status: LoadStatus) => void;
}

export interface CompareBounds {
  min: number;
  max: number;
  step: number;
}

export interface CompareMeta {
  containerRef: RefObject<HTMLDivElement | null>;
  handleRef: RefObject<HTMLDivElement | null>;
  /** Container rect captured on pointerdown; null until first interaction. */
  widthRef: RefObject<DOMRect | null>;
  bounds: CompareBounds;
  controlled: boolean;
  /** Overridable slider aria-label (localizable). */
  label?: string;
}

export interface CompareRevealContextValue {
  state: CompareState;
  actions: CompareActions;
  meta: CompareMeta;
}

export interface SlotProps {
  /**
   * When true, clone the single child and inject onLoad/onError/className/
   * style/ref instead of rendering a default <img>.
   */
  asChild?: boolean;
  src?: string;
  alt?: string;
  className?: string;
  /** Best-effort decode() gate before "loaded"; default true. */
  decode?: boolean;
  children?: ReactNode;
}

export interface HandleProps {
  className?: string;
  /** Custom handle chrome. */
  children?: ReactNode;
  /** Overrides the context/default slider aria-label. */
  "aria-label"?: string;
}

export interface LabelProps {
  slot: Slot;
  className?: string;
  children?: ReactNode;
}

export interface OverlayProps {
  className?: string;
  /** Custom skeleton content while loading. */
  loadingContent?: ReactNode;
  /** Custom error content. */
  errorContent?: ReactNode;
}

export type CompareRevealProps = {
  // image pair (default <img> path)
  beforeSrc?: string;
  afterSrc?: string;
  beforeAlt?: string;
  afterAlt?: string;

  // optional labels (sugar for <CompareReveal.Label>)
  beforeLabel?: string;
  afterLabel?: string;

  // split control
  defaultSplit?: number;
  split?: number;
  onSplitChange?: (pct: number) => void;
  min?: number;
  max?: number;
  keyboardStep?: number;

  // layout / a11y
  aspectRatio?: number | string;
  className?: string;
  label?: string;

  // load lifecycle (host analytics)
  onReady?: () => void;
  onError?: (slot: Slot) => void;

  // gate behavior
  decode?: boolean;

  // escape hatch: compose explicitly instead of beforeSrc/afterSrc
  children?: ReactNode;
};
