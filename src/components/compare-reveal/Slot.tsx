"use client";

import {
  type CSSProperties,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

type Refish<T> = Ref<T> | undefined;

/**
 * Composes several refs into one callback ref. Supports function refs and
 * object refs. Cleanup is best-effort: each ref is reset to null when detached.
 */
export function mergeRefs<T>(
  ...refs: Refish<T>[]
): (instance: T | null) => void {
  return (instance: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(instance);
      } else if (ref != null) {
        (ref as { current: T | null }).current = instance;
      }
    }
  };
}

function mergeHandlers<E>(
  theirs: ((event: E) => void) | undefined,
  ours: (event: E) => void,
): (event: E) => void {
  return (event: E) => {
    theirs?.(event);
    ours(event);
  };
}

/**
 * Props the host child must accept to be a valid `asChild` target. In practice
 * this is any `<img>`-like element (including `next/image`, which forwards
 * `onLoad`/`style`/`ref` to a real `<img>`).
 */
interface InjectableChildProps {
  className?: string;
  style?: CSSProperties;
  ref?: Ref<unknown>;
  onLoad?: (event: unknown) => void;
  onError?: (event: unknown) => void;
}

export interface SlotInjection {
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLImageElement>;
  onLoad: (event: unknown) => void;
  onError: (event: unknown) => void;
}

/**
 * Clones the single child element and injects load wiring, structural
 * className/style, and a merged ref. The host can't forget to forward
 * onLoad/onError because we inject them ourselves.
 */
export function injectIntoChild(
  child: ReactNode,
  injection: SlotInjection,
): ReactElement {
  if (!isValidElement(child)) {
    throw new Error(
      "CompareReveal.Before/.After with `asChild` expects a single React element child.",
    );
  }

  const element = child as ReactElement<InjectableChildProps>;
  const childProps = element.props;

  const mergedClassName = [injection.className, childProps.className]
    .filter(Boolean)
    .join(" ");

  const mergedStyle: CSSProperties = {
    ...injection.style,
    ...childProps.style,
  };

  const mergedRef = mergeRefs(
    injection.ref as Refish<unknown>,
    childProps.ref as Refish<unknown>,
  );

  return cloneElement(element, {
    className: mergedClassName || undefined,
    style: mergedStyle,
    ref: mergedRef,
    onLoad: mergeHandlers(childProps.onLoad, injection.onLoad),
    onError: mergeHandlers(childProps.onError, injection.onError),
  } as Partial<InjectableChildProps>);
}
