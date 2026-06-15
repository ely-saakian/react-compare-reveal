"use client";

import { useCallback, useRef, useState } from "react";
import type { LoadStatus, Slot } from "./types";

interface UseSlotLoadOptions {
  onReady?: () => void;
  onError?: (slot: Slot) => void;
}

interface UseSlotLoadResult {
  before: LoadStatus;
  after: LoadStatus;
  setStatus: (slot: Slot, status: LoadStatus) => void;
}

/**
 * Owns per-slot load state and fires `onReady` (both loaded) / `onError`.
 *
 * Status is mirrored into a ref so `setStatus` can synchronously read the
 * combined state at the moment of an update without depending on stale render
 * closures — this keeps `setStatus` referentially stable across renders.
 */
export function useSlotLoad(options: UseSlotLoadOptions): UseSlotLoadResult {
  const [before, setBefore] = useState<LoadStatus>("loading");
  const [after, setAfter] = useState<LoadStatus>("loading");

  const statusRef = useRef<{ before: LoadStatus; after: LoadStatus }>({
    before: "loading",
    after: "loading",
  });

  // Mirror the latest callbacks so setStatus stays stable.
  const onReadyRef = useRef(options.onReady);
  onReadyRef.current = options.onReady;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const setStatus = useCallback((slot: Slot, status: LoadStatus) => {
    if (statusRef.current[slot] === status) return;

    statusRef.current = { ...statusRef.current, [slot]: status };
    if (slot === "before") setBefore(status);
    else setAfter(status);

    if (status === "error") {
      onErrorRef.current?.(slot);
      return;
    }

    const { before: b, after: a } = statusRef.current;
    if (b === "loaded" && a === "loaded") {
      onReadyRef.current?.();
    }
  }, []);

  return { before, after, setStatus };
}

/**
 * Best-effort decode gate. Resolves to "loaded" whether `img.decode()`
 * fulfills OR rejects (rejection happens on src swap mid-decode) so the
 * skeleton can never hang. With `decode === false`, resolves immediately.
 */
export async function resolveLoaded(
  img: HTMLImageElement | null,
  decode: boolean,
): Promise<"loaded"> {
  if (decode && img && typeof img.decode === "function") {
    try {
      await img.decode();
    } catch {
      // Treat decode rejection as loaded — best-effort, never hang.
    }
  }
  return "loaded";
}
