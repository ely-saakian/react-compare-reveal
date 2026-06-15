"use client";

import { createContext, use } from "react";
import type {
  CompareActions,
  CompareMeta,
  CompareRevealContextValue,
  CompareState,
} from "./types";

/** Stable half of the context: actions + meta never change during a gesture. */
export interface CompareControl {
  actions: CompareActions;
  meta: CompareMeta;
}

/**
 * Volatile state (split, isDragging, load status) is kept in its own context so
 * that consumers which only need actions/meta (the image slots) don't re-render
 * on every drag commit. That decoupling is what keeps `next/image` slots from
 * re-rasterizing mid-gesture.
 */
export const CompareStateContext = createContext<CompareState | null>(null);
export const CompareControlContext = createContext<CompareControl | null>(null);

const OUTSIDE = "must be used within a <CompareReveal> provider.";

export function useCompareState(): CompareState {
  const ctx = use(CompareStateContext);
  if (ctx === null) throw new Error(`useCompareState ${OUTSIDE}`);
  return ctx;
}

export function useCompareControl(): CompareControl {
  const ctx = use(CompareControlContext);
  if (ctx === null) throw new Error(`useCompareControl ${OUTSIDE}`);
  return ctx;
}

/**
 * Reads the full context (state + actions + meta). Subscribes to volatile state,
 * so only use it from components that actually render state (e.g. the handle and
 * overlay). Image slots should use `useCompareControl` instead.
 */
export function useCompareReveal(): CompareRevealContextValue {
  return { state: useCompareState(), ...useCompareControl() };
}
