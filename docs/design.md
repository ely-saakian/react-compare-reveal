## R — Requirements

(clarifying questions + functional + non-functional + read-back with out-of-scope)

### clarifying questions → answers

- slider with drag handle (side-by-side reveal), or tabs for Before/After?
  - **slider** — that's the expected UX; tabs out of scope (optional a11y fallback in O only)
- render handle to one edge on load to show only one image for performance?
  - both images need to be available for a smooth drag; can lazy-load/defer the second, but not design around single-image-for-whole-session
- headless / easy to customize appearance, component owns logic + a11y?
  - **yes** — reusable React component; host owns styling, we own interaction + a11y + loading orchestration
- framework agnostic via child/render props (e.g. next/image)?
  - **React shop** — no Web Component / Vue adapter; **do** support composable image layer via `renderBefore` / `renderAfter` (or slots) so hosts can plug in optimized image components
- context / data source?
  - **one comparison per page**; static URLs from CMS/API; no upload flow in v1
- devices?
  - desktop + mobile; handle must work with **touch**

### functional

**core**

- users view before/after images in a side-by-side reveal via a draggable handle
- drag handle works with mouse and touch (mobile)
- users can customize the drag handle (and potentially other UI chrome)
- simple API: `beforeSrc` / `afterSrc` props for basic usage
- composable API: `renderBefore` / `renderAfter` so hosts can supply their own image components (e.g. next/image, `<picture>`, lazy wrappers)

**nice-to-have**

- optional "Before" / "After" text label overlays

### non-functional

- accessible: screen readers, keyboard control of slider position
- performant: 60 FPS during drag (clip/mask updates without layout thrash)
- handles large CMS images (~2–4 MB); both images reachable for smooth reveal (lazy-load/defer ok)
- resilient: graceful UI when an image fails to load (placeholder + error state, don't break the slider)

### read-back

We're building a composable before/after image viewing component for **React on web**, desktop and mobile. One comparison per page, CMS-sourced URLs. Users reveal before vs after via a draggable handle with customizable chrome. Hosts use default URL props or render props for optimized image rendering. Target: smooth 60 FPS interaction and full keyboard/screen-reader support.

### out of scope

- tab-based Before/After switching (primary UX is slider)
- multi-comparison gallery (parent orchestration layer — separate concern)
- image upload / authoring flow
- framework-agnostic (Vue, Svelte, Web Components)

## A — Architecture

(view components, store vs local, data-access layer, data flow, the hard part)

**Hard part:** dual images must stay **pixel-aligned** in the same box while `splitPercent` updates every frame during drag. Clip the "after" layer with GPU-friendly CSS (`clip-path` or `overflow: hidden` + width — no layout reads in the drag loop). Custom `renderBefore` / `renderAfter` must receive an explicit load contract so `ImageLoadGuard` knows when both layers are ready — we don't scrape child DOM.

---

### View (component tree + responsibilities)

```
CompareReveal          ← public API; composes everything below
├── ImageStack             ← fixed aspect box; stacks before/after layers; applies clip
│   ├── BeforeSlot         ← default <img> or renderBefore({ onLoad, onError, ... })
│   └── AfterSlot          ← clipped layer; default <img> or renderAfter(...)
├── SliderHandle           ← draggable thumb + optional labels; pointer + keyboard target
└── LoadOverlay            ← skeleton / error UI driven by ImageLoadGuard state
```

| Piece                                    | Owns                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **CompareReveal**                    | Props → children wiring; controlled vs uncontrolled `splitPercent`; disables interaction until both images loaded                            |
| **ImageStack**                           | Container ref for width measurement; `clip-path: inset(0 ${100-split}% 0 0)` on AfterSlot; shared `object-fit: cover` sizing so layers match |
| **BeforeSlot / AfterSlot**               | Invoke render prop with contract **or** render default `<img src alt onLoad onError>`                                                        |
| **SliderHandle**                         | Visual chrome (customizable via props/className/renderHandle); position = `left: ${split}%`; `role="slider"` + ARIA                          |
| **ImageLoadGuard** (logic + LoadOverlay) | Per-slot load state machine; derived `canInteract`, `hasError`; no knowledge of how images are rendered                                      |

**Suggested build modules** (1 file per concern):

- `CompareReveal.tsx` — public component
- `ImageStack.tsx`, `SliderHandle.tsx`, `LoadOverlay.tsx`
- `useSplitPercent.ts` — pointer/touch drag + keyboard + optional controlled mode
- `useImageSlotLoad.ts` — `{ before, after }` status + register callbacks
- `types.ts` — `SlotRenderProps`, public props

---

### Local state vs store

**No global store.** One leaf component; nothing shared across the app.

| Local (ephemeral)                  | Source                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `splitPercent` (0–100, default 50) | `useSplitPercent` — uncontrolled internal state, or controlled via `splitPercent` + `onSplitChange` props |
| `isDragging`                       | pointer down/up on handle                                                                                 |
| `beforeStatus` / `afterStatus`     | `'loading' \| 'loaded' \| 'error'` — ImageLoadGuard                                                       |
| `containerWidth`                   | ref measure once on mount/resize (for pointer → percent math)                                             |

**Controlled mode (optional, for hosts):** pass `splitPercent` + `onSplitChange`; viewer becomes controlled and doesn't own split state. Useful for "Reset to center" buttons outside the component.

Props (`beforeSrc`, `afterSrc`, labels, render props) are **inputs**, not store — host is source of truth for image sources.

---

### ImageLoadGuard + custom render props

Guard **aggregates** slot reports; it cannot observe arbitrary children.

**Contract passed into `renderBefore` / `renderAfter`:**

```ts
type SlotRenderProps = {
  onLoad: () => void;
  onError: (err?: unknown) => void;
  className: string; // e.g. "ba-layer" — apply to visible image node
  style: CSSProperties; // objectFit cover, fill box — keeps layers aligned
};
```

**Default path:** `<img src={beforeSrc} alt={beforeAlt} onLoad onError className style />`.

**Custom path:** host must forward completion — e.g. next/image `onLoadingComplete={onLoad}`, `onError={onError}`, and apply `className` / `style`.

**Derived UI rules:**

| before  | after   | Behavior                                                                     |
| ------- | ------- | ---------------------------------------------------------------------------- |
| loading | \*      | LoadOverlay skeleton; handle inert                                           |
| loaded  | loading | same                                                                         |
| loaded  | loaded  | `canInteract = true`; enable handle                                          |
| error   | \*      | LoadOverlay error message; handle inert (or show partial if one side loaded) |

Document in README: _custom renderers must call `onLoad` when the image is visually ready_ (not just requested). Prefer decode-complete APIs where available.

---

### Interaction model (`useSplitPercent`)

1. **Pointer:** `onPointerDown` on handle → `setPointerCapture` → `onPointerMove` updates percent from `clientX` vs container width → `onPointerUp` release capture. Works for mouse + touch.
2. **Perf:** write `splitPercent` during drag; apply clip via inline style or CSS variable (`--split: 50`) on AfterSlot — **avoid** `getBoundingClientRect` inside move handler (measure width on mount/resize only).
3. **Optional:** throttle React state to `requestAnimationFrame` if profiling shows excess re-renders (clip can also be driven via ref + direct DOM style update during drag, commit to state on pointer up).
4. **Keyboard:** handle focused → ArrowLeft/ArrowRight adjust by step (e.g. 1% or 5% with Shift); Home/End → 0/100.
5. **Bounds:** clamp 0–100; optional `minSplit` / `maxSplit` props if product needs inset.

---

### Data-access layer

**None inside the component.** Host page fetches CMS URLs and passes props.

Internal only:

- `useImageSlotLoad` — tracks load/error callbacks from slots (not HTTP)
- Browser cache + host's `next/image` handle network/caching

No React Query, no internal fetch, no cache invalidation in v1.

---

### Server (black box)

Out of component boundary. Parent assumes valid HTTPS image URLs (+ alt text from CMS). Component does not call APIs.

---

### Data flow

```
Host (CMS URLs, alt text)
  → props: beforeSrc | renderBefore, afterSrc | renderAfter, labels, className
  → CompareReveal mounts
  → BeforeSlot / AfterSlot mount images → onLoad/onError → useImageSlotLoad
  → both loaded → canInteract → SliderHandle active
  → pointer/keyboard → useSplitPercent → splitPercent → AfterSlot clip-path + handle position
  → optional onSplitChange(splitPercent) → host
```

**Clip update path (hot path):**

`pointermove` → `%` → `--split` or `clip-path` on AfterSlot + `left` on handle → **no layout**, **no network**, **no store dispatch**.

---

### Key implementation choices (for build)

| Decision             | Choice                                                          | Why                                                                                  |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reveal mechanism     | `clip-path: inset()` on after layer                             | GPU-composited; both images same size in stack; handle independent                   |
| Sizing               | Container with `aspect-ratio` prop or `fill` parent             | Prevents layout shift; both layers `position: absolute; inset: 0`                    |
| Handle customization | `renderHandle?(props)` + `handleClassName`                      | Headless-ish chrome without styling opinions                                         |
| Load gating          | Block drag until both loaded                                    | Avoids broken UX mid-load; aligns with NFR                                           |
| Defer second image   | Host concern via render props / `loading="lazy"` on default img | Component still expects both ready before interact; host can prioritize before image |

## D — Data model

(entity table: source · entity · belongs-to · fields; normalized shape; derived fields)

| source                 | entity            | belongs-to                     | fields                                                                  |
| ---------------------- | ----------------- | ------------------------------ | ----------------------------------------------------------------------- |
| server (host props)    | ImagePair         | CompareReveal              | `beforeSrc`, `afterSrc`, `beforeAlt`, `afterAlt`                        |
| server (host props)    | Labels            | CompareReveal              | `beforeLabel?`, `afterLabel?` (nice-to-have overlays)                   |
| client-only, ephemeral | ViewerInteraction | `useSplitPercent`              | `splitPercent` (0–100), `isDragging`, `containerWidth`                  |
| client-only, ephemeral | SlotLoadState     | `useImageSlotLoad`             | `beforeStatus`, `afterStatus` — each `'loading' \| 'loaded' \| 'error'` |
| derived                | ViewerDerived     | CompareReveal / ImageStack | `canInteract`, `hasError`, `afterClipPath`                              |

**No normalization across instances** — single leaf component, no `byId` / `allIds`. One in-memory object per mount:

```ts
type LoadStatus = "loading" | "loaded" | "error";

type ViewerState = {
  interaction: {
    splitPercent: number; // default 50; clamped [minSplit, maxSplit]
    isDragging: boolean;
    containerWidth: number; // px; measured on mount + ResizeObserver
  };
  slots: {
    before: LoadStatus;
    after: LoadStatus;
  };
};

// DERIVED — compute, don't store
canInteract = slots.before === "loaded" && slots.after === "loaded";
hasError = slots.before === "error" || slots.after === "error";
afterClipPath = `inset(0 ${100 - splitPercent}% 0 0)`;
handlePositionPct = splitPercent; // same value, used for left % on handle
```

**Field notes (build):**

- **`beforeAlt` / `afterAlt`:** required when using default `<img>` path (a11y); host supplies from CMS.
- **`splitPercent`:** reset to `defaultSplit` (prop, default 50) when `beforeSrc` or `afterSrc` changes (new comparison mounted).
- **Slot status:** reset both to `'loading'` when image sources change; ImageLoadGuard re-gates interaction.
- **`containerWidth`:** 0 until first measure — pointer math no-ops until > 0.

**Host CMS shape (page level, not stored inside component):** maps cleanly to props:

```ts
// what the marketing page gets from CMS → what it passes down
type CmsComparison = {
  before: { url: string; alt: string };
  after: { url: string; alt: string };
  labels?: { before?: string; after?: string };
};
```

Consistency check vs Architecture + Interface:

- `SlotLoadState` statuses are set only via `onLoad` / `onError` in `SlotRenderProps` — same contract in D, A, and I.
- `afterClipPath` is derived from `splitPercent` only — ImageStack reads derived value, never stores clip separately.
- Host props (`ImagePair`, `Labels`) are read-only inputs; `splitPercent` is the only mutable user-driven field in v1 (not persisted).

## I — Interface

(protocol choice + justification; key API contracts w/ params, response, error shape; client-client store actions)

**Protocol:** **React props + callbacks** — no HTTP, WebSocket, or SSE inside the component. Correct choice for a leaf UI library: the host owns data fetching; the component owns interaction + a11y + load orchestration. Network protocol (REST to CMS) lives at the **host page boundary** only.

---

### Host boundary (page ↔ CMS) — reference for integration, not implemented in component

**REST `GET /api/pages/:slug`** (or static CMS JSON — same shape)

```
// Response 200
{
  "comparison": {
    "before": { "url": "https://cdn.example/before.jpg", "alt": "Kitchen before renovation" },
    "after":  { "url": "https://cdn.example/after.jpg",  "alt": "Kitchen after renovation" },
    "labels": { "before": "Before", "after": "After" }
  }
}

// Response 404
{ "error": { "code": "NOT_FOUND", "message": "Page not found" } }
```

Host maps `comparison` → `<CompareReveal beforeSrc={...} afterSrc={...} ... />`. Component never calls this endpoint.

---

### Component public API — `CompareReveal`

```ts
type CompareRevealProps = {
  // --- ImagePair (default path) ---
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;

  // --- Labels (optional) ---
  beforeLabel?: string;
  afterLabel?: string;

  // --- Composable image slots (override default <img>) ---
  renderBefore?: (props: SlotRenderProps) => React.ReactNode;
  renderAfter?: (props: SlotRenderProps) => React.ReactNode;

  // --- Split control ---
  defaultSplit?: number; // default 50
  splitPercent?: number; // controlled mode
  onSplitChange?: (percent: number) => void;
  minSplit?: number; // default 0
  maxSplit?: number; // default 100
  keyboardStep?: number; // default 1; use 5 with Shift

  // --- Layout ---
  aspectRatio?: number | string; // e.g. 16/9 or "3/2"; prevents layout shift
  className?: string;

  // --- Handle customization ---
  renderHandle?: (props: HandleRenderProps) => React.ReactNode;
  handleClassName?: string;

  // --- Load lifecycle callbacks (optional, for host analytics) ---
  onImagesReady?: () => void; // both slots loaded
  onImageError?: (slot: "before" | "after", err?: unknown) => void;
};
```

**Validation / error behavior (component-internal, not HTTP):**

| Condition                                            | Behavior                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Missing `beforeSrc` / `afterSrc` when no render prop | dev warning + LoadOverlay error                                           |
| `renderBefore` provided without forwarding `onLoad`  | stuck in loading — documented host responsibility                         |
| Image `onError`                                      | slot → `'error'`; `onImageError(slot)`; LoadOverlay message; handle inert |
| Controlled `splitPercent` without `onSplitChange`    | dev warning (React controlled-component convention)                       |

---

### Render prop contracts

```ts
type SlotRenderProps = {
  onLoad: () => void;
  onError: (err?: unknown) => void;
  className: string; // "ba-layer" — must apply to visible image node
  style: React.CSSProperties; // absolute fill + object-fit cover
};

type HandleRenderProps = {
  splitPercent: number;
  isDragging: boolean;
  disabled: boolean; // !canInteract
  /** spread onto handle root — includes role, tabIndex, aria-* , pointer handlers */
  handleProps: React.HTMLAttributes<HTMLElement> & {
    ref: React.Ref<HTMLElement>;
  };
};
```

**Example — next/image host:**

```tsx
<CompareReveal
  beforeSrc={url}
  afterSrc={url2}
  beforeAlt="..."
  afterAlt="..."
  renderBefore={({ onLoad, onError, className, style }) => (
    <Image
      src={beforeUrl}
      alt="..."
      fill
      className={className}
      style={style}
      onLoadingComplete={onLoad}
      onError={onError}
    />
  )}
/>
```

---

### Internal hook actions (client ↔ client — no global store)

Equivalent to store actions but scoped to `useSplitPercent` + `useImageSlotLoad` inside the viewer:

**`useSplitPercent`**

| Action             | Payload               | Effect                                                            |
| ------------------ | --------------------- | ----------------------------------------------------------------- |
| `SPLIT_SET`        | `{ percent: number }` | clamp → update `splitPercent`; call `onSplitChange` if controlled |
| `SPLIT_DRAG_START` | —                     | `isDragging = true`                                               |
| `SPLIT_DRAG_END`   | —                     | `isDragging = false`                                              |
| `CONTAINER_RESIZE` | `{ width: number }`   | update `containerWidth`                                           |
| `SPLIT_NUDGE`      | `{ delta: number }`   | keyboard arrow; uses `keyboardStep`                               |

**`useImageSlotLoad`**

| Action               | Payload    | Effect                                                        |
| -------------------- | ---------- | ------------------------------------------------------------- |
| `SLOT_BEFORE_LOADED` | —          | `beforeStatus = 'loaded'`; if both loaded → `onImagesReady()` |
| `SLOT_BEFORE_ERROR`  | `{ err? }` | `beforeStatus = 'error'`; `onImageError('before', err)`       |
| `SLOT_AFTER_LOADED`  | —          | `afterStatus = 'loaded'`; if both loaded → `onImagesReady()`  |
| `SLOT_AFTER_ERROR`   | `{ err? }` | `afterStatus = 'error'`; `onImageError('after', err)`         |
| `SLOTS_RESET`        | —          | both → `'loading'` (on src change)                            |

**Accessibility contract on handle (applied via `handleProps`):**

```
role="slider"
aria-valuemin={minSplit}
aria-valuemax={maxSplit}
aria-valuenow={splitPercent}
aria-label="Compare before and after images"
aria-disabled={!canInteract}
```

Consistency check vs D:

- `SlotRenderProps.onLoad` / `onError` are the **only** inputs that mutate `SlotLoadState` — maps 1:1 to `SLOT_*` actions.
- `onSplitChange(percent)` emits the same `splitPercent` stored in `ViewerInteraction` (controlled or uncontrolled).
- `HandleRenderProps.disabled` === `!canInteract` derived from D's slot statuses.
- CMS `comparison.before.url` → `beforeSrc`; `comparison.before.alt` → `beforeAlt` — same names at host boundary and component props.

## O — Optimizations & deep dive

(pick 2 areas relevant to a Before/After image viewer; go deep with explicit tradeoffs; name 1 thing you'd skip)

**Why these two:** This component lives or dies on **smooth drag at 60 FPS** while two large images stay aligned — that's pure front-end performance engineering on the hot path. **Accessibility** is the other axis: a slider reveal has no native HTML element; if keyboard, screen reader, touch, and reduced-motion users can't compare images, the feature fails. Resilience (load errors, gating interaction) is already designed in A/D/I — I'll name it, not re-derive it.

---

### Performance — drag hot path + image readiness

The drag loop is: `pointermove` → `%` → clip + handle position. Everything else (network, React reconciliation of unrelated trees) must stay out of that path.

**1. Split updates during drag — ref + CSS variable, state on pointer up**

- **Option A:** `setState(splitPercent)` on every `pointermove`.
  - Simple, React-idiomatic.
  - **Cost:** re-renders ImageStack + children every frame → often misses 60 FPS on low-end mobile with two large decoded images.
- **Option B (pick):** during drag, write `--split` on container ref + update clip/handle via direct DOM; commit React state once on `pointerup` (and on keyboard nudge).
  - **Cost:** split logic split across ref imperatives + state; must keep controlled mode (`splitPercent` prop) in sync.
  - **Mitigation:** controlled mode always goes through state; uncontrolled uses ref path during drag only.

```ts
// hot path (pseudocode)
onPointerMove(e) {
  const pct = clamp((e.clientX - left) / containerWidth * 100, min, max);
  containerRef.current.style.setProperty('--split', String(pct));
  afterSlotRef.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  handleRef.current.style.left = `${pct}%`;
}
onPointerUp() {
  setSplitPercent(pct);           // single React commit
  onSplitChange?.(pct);
}
```

**2. Clip mechanism — `clip-path: inset()` on AfterSlot**

- **Option A:** `overflow: hidden` on a wrapper whose `width` = `splitPercent%`.
  - **Cost:** width change can trigger layout; both layers must stay in sync manually.
- **Option B (pick):** `clip-path: inset(0 ${100 - split}% 0 0)` on absolutely positioned AfterSlot.
  - **Cost:** older browsers without `clip-path` need a fallback (acceptable for target stack); test Safari iOS.
  - Both layers `position: absolute; inset: 0; object-fit: cover` — no layout on drag.

**3. Layout reads — measure once, never in move handler**

- `containerWidth` from `ResizeObserver` on mount (debounced ~100ms).
- **Cost:** stale width if container resizes mid-drag (rare) → re-measure on observer callback, not on every move.
- Pointer `%` math uses cached width only.

**4. Touch scroll — `touch-action: none` on handle while dragging**

- **Option:** allow vertical page scroll during horizontal drag.
  - **Cost:** browser gesture negotiation fights the slider → jank + accidental scroll.
- **Pick:** `touch-action: none` on handle; `setPointerCapture` on pointer down. Page scroll resumes on pointer up.

**5. Image readiness — decode before `canInteract`**

- **Option A:** gate on `onLoad` only.
  - **Cost:** image dimensions known but bitmap not decoded → first drag frame stutters.
- **Option B (pick):** after `onLoad`, await `img.decode()` (or next/image `onLoadingComplete`) before `SLOT_*_LOADED`.
  - **Cost:** slightly longer skeleton; custom render props must use decode-complete APIs.
  - Default `<img>` path: `onLoad` → `await ref.decode()` → then report loaded.

**6. Preload strategy**

- Default path: both images fetch on mount (no `loading="lazy"` on after image).
- Host using render props: document `priority` / eager loading for both URLs.
- **Tradeoff:** lazy second image saves initial bytes but causes pop-in mid-drag — violates NFR.

**7. Compositor hint — `will-change: clip-path` only while `isDragging`**

- Apply on AfterSlot during drag; remove on pointer up.
- **Cost of always-on:** extra GPU layer memory for the lifetime of the page.

**8. CLS / LCP (folded in)**

- `aspectRatio` prop reserves box before decode → no layout shift when images appear.
- LoadOverlay skeleton fills same aspect box.

---

### Accessibility — slider semantics, touch targets, reduced motion

**1. Slider ARIA — `role="slider"` + meaningful value text**

```
role="slider"
aria-valuemin={minSplit}
aria-valuemax={maxSplit}
aria-valuenow={splitPercent}
aria-valuetext={`Before ${splitPercent}%, After ${100 - splitPercent}%`}
aria-label="Compare before and after images"
aria-disabled={!canInteract}
```

- **`aria-valuetext` (pick):** announces meaningful comparison; `valuenow` alone ("50") is useless.
- **Cost:** string updates every nudge — acceptable; debounce SR updates only if profiling shows issue (unlikely).

**2. Focus — handle focusable only when `canInteract`**

- `tabIndex={canInteract ? 0 : -1}` on handle.
- **Cost:** skipping this lets users tab to a broken control during loading.

**3. Keyboard — already in I; O adds delivery detail**

- ArrowLeft/Right → `SPLIT_NUDGE`; Shift → larger step.
- Home/End → min/max split.
- Focus ring visible (`:focus-visible`) — don't rely on browser default alone.

**4. Touch target — 44×44px minimum hit area**

- Visual handle can be a thin line; expand hit target via padding or invisible pseudo-element.
- **Tradeoff:** larger handle overlaps image content → use transparent expanded box, not bigger visible chrome.

**5. Labels — `beforeLabel` / `afterLabel` overlays**

- If provided, ensure contrast against image (host can style; document WCAG AA expectation).
- Don't `aria-hidden` labels if they're the only textual description of each side.

**6. `prefers-reduced-motion`**

- **Option A:** replace slider with Before/After tabs.
  - **Cost:** different UX; more code paths (deferred to v1.1 per R).
- **Option B (pick for v1):** disable CSS transitions on handle; no animated snap; slider still works via keyboard/pointer.
  - Drag remains functional — reduced motion ≠ reduced interaction.
  - Optional: respect `prefers-reduced-motion` for any future transition on split change.

**7. Optional fallback (v1.1 — note, don't build in v1 unless time)**

- Toggle buttons "Show before" / "Show after" at 0% / 100% split for users who can't operate a slider.
- **Tradeoff:** extra UI + state; document as progressive enhancement path.

---

### Resilience (named, not re-derived)

Already in A/D/I: per-slot error state, LoadOverlay, inert handle on failure, `onImageError` callback. v1: no retry button — host remounts or changes src.

---

### Skip

**CSS-in-JS library, bundler, and exact handle visual design** — implementation/presentation choices; they don't change clip strategy, load gating, or ARIA contract. Virtualization and gallery orchestration are out of scope (single comparison).

---

### Pre-build checklist (from O)

- [ ] `useSplitPercent`: ref/DOM path during drag, state commit on pointer up
- [ ] `useImageSlotLoad`: await decode before `loaded`
- [ ] AfterSlot: `clip-path` + absolute stack + `object-fit: cover`
- [ ] Handle: `aria-valuetext`, 44px hit target, focus only when `canInteract`
- [ ] Container: `aspectRatio`, `ResizeObserver`, `--split` CSS variable
- [ ] `touch-action: none` + pointer capture on drag
- [ ] `prefers-reduced-motion`: no spurious transitions
