"use client";

import Image from "next/image";
import { useState } from "react";
import { CompareReveal } from "@/components/compare-reveal";

const SIZES = "(min-width: 672px) 672px, 100vw";

export function CompareRevealDemo() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-12">
      <FlatControlledDemo />
      <CompoundDemo />
    </div>
  );
}

/**
 * Flat API in controlled mode: the host owns `split` (exercised by the reset
 * button) and the convenience props build the compound tree internally (raw
 * <img> path).
 */
function FlatControlledDemo() {
  const [split, setSplit] = useState(50);

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg text-zinc-900 dark:text-zinc-50">
          Flat API (controlled)
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Convenience props plus host-owned <code>split</code> state.
        </p>
      </div>

      <CompareReveal
        beforeSrc="/before.webp"
        afterSrc="/after.jpg"
        beforeAlt="Sports car, before"
        afterAlt="Sports car, after"
        beforeLabel="Before"
        afterLabel="After"
        aspectRatio={16 / 9}
        split={split}
        onSplitChange={setSplit}
        label="Compare the car before and after"
        className="w-full rounded-2xl shadow-lg ring-1 ring-black/10"
      />

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Split:{" "}
          <span className="font-mono font-medium tabular-nums">
            {Math.round(split)}%
          </span>
        </p>
        <button
          type="button"
          onClick={() => setSplit(50)}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Reset to center
        </button>
      </div>
    </section>
  );
}

/**
 * Compound API in uncontrolled mode: compose the parts directly. Demonstrates
 * the `asChild` slot with <code>next/image</code> (CompareReveal injects load
 * wiring + layer styles onto the host element), a custom handle, custom labels,
 * and custom overlay content.
 */
function CompoundDemo() {
  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg text-zinc-900 dark:text-zinc-50">
          Compound API (uncontrolled)
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Composed parts, <code>next/image</code> via <code>asChild</code>, and
          custom chrome.
        </p>
      </div>

      <CompareReveal
        defaultSplit={50}
        aspectRatio={16 / 9}
        label="Compare the car before and after"
        className="w-full rounded-2xl shadow-lg ring-1 ring-black/10"
      >
        <CompareReveal.Before asChild>
          <Image
            src="/before.webp"
            alt="Sports car, before"
            fill
            sizes={SIZES}
            priority
          />
        </CompareReveal.Before>

        <CompareReveal.After asChild>
          <Image src="/after.jpg" alt="Sports car, after" fill sizes={SIZES} />
        </CompareReveal.After>

        <CompareReveal.Label slot="before">Before</CompareReveal.Label>
        <CompareReveal.Label slot="after">After</CompareReveal.Label>

        <CompareReveal.Handle />

        <CompareReveal.Overlay
          loadingContent={
            <div className="grid h-full place-items-center text-sm text-zinc-500">
              Loading comparison…
            </div>
          }
          errorContent="Couldn't load one of the images."
        />
      </CompareReveal>
    </section>
  );
}
