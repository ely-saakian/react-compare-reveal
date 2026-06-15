# CompareReveal — Revised Design (v2)

> Supersedes `docs/design.md`. Same R-A-D-I-O structure, but the API and
> component architecture are reworked to match the project's actual stack
> (**Next 16, React 19.2, React Compiler enabled**) and to fix concrete holes
> in v1. See **§ Changes from v1** for the diff and rationale.

---

## Changes from v1 (holes fixed)

| # | v1 choice | Problem | v2 choice |
| - | --------- | ------- | --------- |
| 1 | `renderBefore` / `renderAfter` / `renderHandle` render props | Composition guideline says prefer children; host must hand-forward `onLoad`/`onError`/`className`/`style`; "forgot `onLoad` → stuck loading forever" is a documented failure mode | **Compound components + `asChild` Slot**. We *inject* load/style wiring; host can't forget. Flat prop API kept as a thin convenience wrapper. |
| 2 | Hot path writes 3 DOM nodes/frame (`--split` + after `clipPath` + handle `left`) and syncs state + controlled mode | More moving parts than necessary; easy to desync | **One `--split` CSS var** on the container; CSS `calc()` derives clip + handle. One DOM write/frame, zero re-renders during drag. |
| 3 | `useEffect` to reset split + slot status on src change | "You might not need an effect" anti-pattern → extra renders, state drift | **Keyed remount** (`key` from sources) resets everything for free. |
| 4 | `containerWidth` in React state + `ResizeObserver` | Width is never rendered; storing it causes pointless re-renders | **Width in a ref**, measured from `getBoundingClientRect()` on `pointerdown`. `ResizeObserver` dropped from core. |
| 5 | "Controlled mode always goes through state" | Silently re-renders parent every frame, defeating the ref optimization | **Explicit tradeoff**: controlled = rAF-throttled `onSplitChange`; host owns per-frame render cost. |
| 6 | `forwardRef`, `useContext`, manual memo assumptions | Outdated for React 19 + Compiler | `ref` as a plain prop, `use(Context)`, no `forwardRef`. Compiler-aware perf notes. |
| 7 | `next/image` `onLoadingComplete`; unguarded `img.decode()`; no `fetchPriority`; hardcoded `aria-label` | Deprecated API; `decode()` can reject and hang the skeleton; LCP not helped; not localizable | `onLoad`; **best-effort decode that can't hang**; `fetchPriority="high"` on before image; overridable `aria-label`. |
| 8 | Drag only from the handle | Poor touch UX | **Pointerdown anywhere on the stack** jumps + drags; handle is the focusable a11y target. |

---

## R — Requirements

Unchanged from v1 except where noted. Building a **composable before/after
image reveal component for React on web** (desktop + mobile), one comparison per
page, CMS-sourced URLs. Slider reveal via a draggable, keyboard-operable,
screen-reader-friendly handle. Host owns data + styling; component owns
interaction, a11y, and load orchestration.

### Functional
- Side-by-side reveal via a draggable handle (mouse + touch).
- **Click/tap anywhere on the stack** repositions the handle and starts a drag (new in v2).
- Two API tiers:
  - **Flat:** `beforeSrc` / `afterSrc` (+ alts) for the common case.
  - **Composable:** compound components + `asChild` so hosts plug in `next/image`, `<picture>`, etc.
- Customizable handle chrome and optional Before/After labels — **as subcomponents**, not props.

### Non-functional
- 60 FPS drag: no layout reads, no network, no React state writes on the hot path.
- Handles 2–4 MB CMS images; both reachable before interaction is enabled.
- Resilient: per-slot error/placeholder UI that never breaks the slider.
- Accessible: keyboard, screen reader, touch targets, reduced motion.
- SSR-safe (Next 16 App Router): deterministic first paint, no hydration mismatch.

### Out of scope
Tabs UX (a11y fallback only), multi-comparison gallery, upload/authoring,
non-React frameworks.

---

## A — Architecture

**Hard part (unchanged framing):** two images must stay pixel-aligned in one box
while the split updates every frame. v2's key move is that **the split is *not*
React state during a drag** — it's a single CSS custom property mutated
imperatively. That one decision is what makes both the perf hot path *and* the
compound-component/context architecture cheap (context value changes only on
load events + `pointerup`, never per frame).

### Component tree

```
<CompareReveal>                 ← Provider + root box; owns split/load state, refs
  <CompareReveal.Before>        ← before layer (default <img> OR asChild)
  <CompareReveal.After>         ← after layer, clipped via var(--split)
  <CompareReveal.Handle>        ← role="slider"; pointer + keyboard target
  <CompareReveal.Label slot=…>  ← optional overlay text (children)
  <CompareReveal.Overlay>       ← skeleton / error UI (reads load state)
```

`CompareReveal` is a context **provider**; subcomponents consume via `use()`.
This follows `architecture-compound-components` and `state-context-interface`.

| Piece | Owns |
| ----- | ---- |
| **`CompareReveal`** (provider) | Committed `split` state, `isDragging`, slot load state, refs (`containerRef`, `widthRef`, `handleRef`); controlled/uncontrolled resolution; renders `style={{ '--split': committedSplit }}` on the box |
| **`.Before` / `.After`** | Render default `<img>` or clone an `asChild` child, injecting `onLoad`/`onError`/merged `className`/`style`/ref; register into load state. `.After` carries `clip-path` driven by `--split` |
| **`.Handle`** | Visual chrome (via `className`/children); `left: calc(var(--split) * 1%)`; pointer + keyboard handlers; full ARIA slider semantics |
| **`.Label`** | Positioned overlay; plain `children` |
| **`.Overlay`** | Skeleton while loading, message on error; reads derived `canInteract`/`hasError` |

### Context interface (`state` / `actions` / `meta`)

```ts
interface CompareState {
  split: number;            // committed value (0–100); NOT updated per drag frame
  isDragging: boolean;
  before: LoadStatus;       // 'loading' | 'loaded' | 'error'
  after: LoadStatus;
}

interface CompareActions {
  // Hot path: write CSS var only. Commit on release.
  beginDrag: (clientX: number) => void;
  drag: (clientX: number) => void;       // imperative: sets --split, no setState
  endDrag: () => void;                    // commits split → state + onSplitChange
  nudge: (delta: number) => void;         // keyboard; commits immediately
  setStatus: (slot: Slot, status: LoadStatus) => void;
}

interface CompareMeta {
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleRef: React.RefObject<HTMLDivElement | null>;
  widthRef: React.RefObject<DOMRect | null>;   // captured on pointerdown
  bounds: { min: number; max: number; step: number };
  controlled: boolean;
}

const CompareRevealContext =
  createContext<{ state: CompareState; actions: CompareActions; meta: CompareMeta } | null>(null);
```

Subcomponents call `use(CompareRevealContext)` (React 19). No `forwardRef`
anywhere — `ref` is a normal prop.

### Build modules (1 concern per file)
- `CompareReveal.tsx` — provider + root box + flat-wrapper export
- `parts.tsx` — `Before`, `After`, `Handle`, `Label`, `Overlay`
- `context.ts` — context + `useCompareReveal()` hook (throws if outside provider)
- `useSplit.ts` — drag/keyboard logic, controlled/uncontrolled, CSS-var writes
- `useSlotLoad.ts` — per-slot load + best-effort decode
- `Slot.tsx` — `asChild` clone+merge (ref/className/style/handlers)
- `types.ts` — public types

### Local state vs store
No global store. State lives in the provider:

| Lives in | What | Why |
| -------- | ---- | --- |
| `useState` (provider) | `split` (committed), `isDragging`, `before`, `after` | Each drives UI; changes are rare (load events, `pointerup`) |
| `useRef` | container node, handle node, **container rect / width** | Transient, read in the pointer loop; must not re-render (`rerender-use-ref-transient-values`) |
| derived in render | `canInteract`, `hasError`, clip + handle position (CSS) | `rerender-derived-state-no-effect` — never stored |

**Resets use keys, not effects.** When the comparison changes, the host (or the
flat wrapper) sets `key={`${beforeSrc}|${afterSrc}`}`, remounting the subtree:
split returns to `defaultSplit`, slot status returns to `loading`. No
`useEffect`, no drift.

### Data flow

```
Host (CMS URLs + alt)
  → <CompareReveal split?/defaultSplit/onSplitChange>  (key = sources)
      <CompareReveal.Before> / <.After>  →  inject onLoad/onError  →  setStatus
      both loaded (+ decoded)            →  canInteract = true     →  Handle enabled
  pointerdown on stack  → capture rect into widthRef, beginDrag
  pointermove           → drag(clientX): containerRef.style.setProperty('--split', pct)
                          (CSS calc updates clip + handle; NO React render)
  pointerup             → endDrag(): setSplit(pct) + onSplitChange?.(pct)
  Arrow/Home/End        → nudge(): commit immediately (low frequency)
```

### Key implementation choices

| Decision | Choice | Why |
| -------- | ------ | --- |
| Reveal | `clip-path: inset(0 calc(100% - var(--split) * 1%) 0 0)` on `.After` | GPU-composited; both layers absolute + `object-fit: cover`; no layout |
| Hot path | Set **one** `--split` var on container ref per frame; commit state on release | One DOM write, zero renders; CSS derives clip + handle together |
| Slots | `asChild` Slot (clone + inject) with default `<img>` fallback | Children compose naturally; host can't forget load wiring |
| Sizing | `aspectRatio` prop reserves the box pre-decode | Prevents CLS; both layers `position: absolute; inset: 0` |
| Load gate | Drag enabled only when both slots `loaded`; before image shown immediately | Avoids broken mid-load reveal |
| Width | `getBoundingClientRect()` on `pointerdown` → `widthRef` | Robust to scroll/resize without an observer in the hot path |

---

## D — Data model

```ts
type LoadStatus = "loading" | "loaded" | "error";
type Slot = "before" | "after";

// One in-memory object per mount (no normalization — single leaf component)
type CompareState = {
  split: number;        // committed; default = defaultSplit; clamped [min, max]
  isDragging: boolean;
  before: LoadStatus;
  after: LoadStatus;
};

// DERIVED — computed in render / CSS, never stored
const canInteract = before === "loaded" && after === "loaded";
const hasError    = before === "error"  || after === "error";
// CSS, not JS:
//   --split        : <committed split>        (inline on container; overwritten imperatively while dragging)
//   .After clip    : inset(0 calc(100% - var(--split) * 1%) 0 0)
//   .Handle left   : calc(var(--split) * 1%)
```

**Transient (refs, not state):** live drag percent, container rect/width.
These never live in `CompareState` because nothing renders from them directly.

| source | entity | belongs-to | fields |
| ------ | ------ | ---------- | ------ |
| host props | ImagePair | `CompareReveal` / `.Before` / `.After` | `beforeSrc`, `afterSrc`, `beforeAlt`, `afterAlt` |
| host children | Labels | `.Label` | label text (children) |
| client, ephemeral | Interaction | `useSplit` | `split` (state), live pct (ref), rect (ref), `isDragging` |
| client, ephemeral | SlotLoad | `useSlotLoad` | `before`, `after` |
| derived | — | render / CSS | `canInteract`, `hasError`, clip, handle position |

**Field notes**
- `beforeAlt` / `afterAlt` required on the default `<img>` path; with `asChild`, alt is the host's child's responsibility.
- Source change → **remount via `key`** (resets split + status). No effect.
- `widthRef` is `null` until first `pointerdown`; pointer math no-ops if absent.

---

## I — Interface

**Protocol:** React props + context + callbacks. No HTTP/WS/SSE in the
component; the host fetches CMS data and passes it down. (Host ↔ CMS boundary
unchanged from v1 — `GET /api/pages/:slug` returning `{ comparison: { before, after, labels } }`.)

### Tier 1 — Flat convenience API (built on the compound API)

```tsx
<CompareReveal
  beforeSrc={c.before.url} afterSrc={c.after.url}
  beforeAlt={c.before.alt} afterAlt={c.after.alt}
  beforeLabel="Before" afterLabel="After"
  defaultSplit={50}
  aspectRatio={16 / 9}
  onSplitChange={(pct) => {}}
/>
```

```ts
type CompareRevealProps = {
  // image pair (default <img> path)
  beforeSrc?: string; afterSrc?: string;
  beforeAlt?: string; afterAlt?: string;

  // optional labels (sugar for <CompareReveal.Label>)
  beforeLabel?: string; afterLabel?: string;

  // split control
  defaultSplit?: number;   // default 50 (uncontrolled)
  split?: number;          // controlled
  onSplitChange?: (pct: number) => void;
  min?: number;            // default 0
  max?: number;            // default 100
  keyboardStep?: number;   // default 1 (×5 with Shift)

  // layout / a11y
  aspectRatio?: number | string;
  className?: string;
  label?: string;          // overrides default slider aria-label (localizable)

  // load lifecycle (host analytics)
  onReady?: () => void;             // both loaded + decoded
  onError?: (slot: Slot) => void;

  // gate behavior
  decode?: boolean;        // default true; await best-effort decode before "loaded"

  // escape hatch: compose explicitly instead of beforeSrc/afterSrc
  children?: React.ReactNode;
};
```

> When `children` are provided, the flat image/label props are ignored and the
> consumer composes the parts directly. This is the `architecture-avoid-boolean-props`
> escape: instead of growing `showLabel`, `customHandle`, `clippedSide`… booleans,
> you drop into composition.

### Tier 2 — Compound API (`asChild` for custom images)

```tsx
<CompareReveal defaultSplit={50} aspectRatio={16 / 9} label="Compare kitchen renovation">
  <CompareReveal.Before asChild>
    <Image src={c.before.url} alt={c.before.alt} fill priority />
  </CompareReveal.Before>

  <CompareReveal.After asChild>
    <Image src={c.after.url} alt={c.after.alt} fill />
  </CompareReveal.After>

  <CompareReveal.Label slot="before">Before</CompareReveal.Label>
  <CompareReveal.Label slot="after">After</CompareReveal.Label>

  <CompareReveal.Handle className="my-handle" />
  <CompareReveal.Overlay />
</CompareReveal>
```

**`asChild` contract (Slot):** `.Before` / `.After` clone their single child and
**inject** `onLoad`, `onError`, a merged `className` (`ba-layer`), a merged
`style` (absolute fill + `object-fit: cover`), and a merged `ref`. The host does
**not** wire load callbacks manually — that removes v1's "forgot `onLoad` →
stuck loading" failure mode. Requirement on the child: it must forward `onLoad`
/ `style` / `ref` to a real `<img>` (which `next/image` does). Default (no
`asChild`): we render `<img src alt onLoad onError className style />` ourselves.

> `next/image`: use **`onLoad`** (v2). `onLoadingComplete` is deprecated/removed
> in current Next — v1's example was stale. With `asChild` we inject `onLoad`, so
> the host doesn't touch it.

### Handle customization — children, not a render prop

```tsx
<CompareReveal.Handle className="bar">
  <GripIcon />            {/* children = the visual chrome */}
</CompareReveal.Handle>
```

`.Handle` reads `state`/`meta` from context and applies ARIA + position itself.
No `renderHandle(props)` callback signature to learn (`patterns-children-over-render-props`).

### Validation / error behavior

| Condition | Behavior |
| --------- | -------- |
| No `beforeSrc`/`afterSrc` and no `asChild`/children for a slot | dev warning + `.Overlay` error |
| `asChild` child never forwards `onLoad` | stays loading — but we inject `onLoad`, so only happens if the child swallows it (documented) |
| Image `onError` | slot → `error`; `onError(slot)`; `.Overlay` message; handle inert |
| `decode()` rejects (e.g. src swapped mid-decode) | treat as **loaded** (best-effort) — never hang the skeleton |
| `split` set without `onSplitChange` | dev warning (controlled-component convention) |

### Internal actions (context `actions`)

| Action | Effect |
| ------ | ------ |
| `beginDrag(clientX)` | capture container rect → `widthRef`; `isDragging = true`; jump to pointer position (click-to-position) |
| `drag(clientX)` | compute pct from rect; `container.style.setProperty('--split', pct)`. **No setState.** Controlled: rAF-throttled `onSplitChange(pct)` |
| `endDrag()` | `isDragging = false`; uncontrolled: `setSplit(pct)`; always `onSplitChange?.(pct)` |
| `nudge(delta)` | clamp `split ± step`; commit to state; `onSplitChange` (low frequency, fine to render) |
| `setStatus(slot, status)` | update slot; if both `loaded` → `onReady()`; if `error` → `onError(slot)` |

### Accessibility contract (on `.Handle`)

```
role="slider"
aria-orientation="horizontal"
aria-valuemin={min} aria-valuemax={max} aria-valuenow={split}
aria-valuetext={`Before ${split}%, After ${100 - split}%`}
aria-label={label ?? "Compare before and after images"}   // overridable / localizable
aria-disabled={!canInteract}
tabIndex={canInteract ? 0 : -1}
```

---

## O — Optimizations & deep dive

Same two axes as v1 — **drag perf** and **a11y** — but updated for the v2
architecture and the React Compiler.

### Performance

**1. Split during drag — one CSS var, commit on release (the core idea).**
- Reject: `setState` per `pointermove` (re-renders the layers + handle every frame).
- Pick: imperatively `container.style.setProperty('--split', pct)`; CSS derives
  *both* `.After` clip and `.Handle` position from `var(--split)`. Commit to
  React state only on `pointerup` / keyboard nudge.

```ts
function drag(clientX: number) {
  const rect = widthRef.current; if (!rect) return;
  const pct = clamp(((clientX - rect.left) / rect.width) * 100, min, max);
  containerRef.current?.style.setProperty("--split", String(pct));   // ONE write
  liveRef.current = pct;
  if (controlled) scheduleRaf(() => onSplitChange?.(pct));            // controlled cost is host's
}
function endDrag() {
  setIsDragging(false);
  const pct = liveRef.current;
  if (!controlled) setSplit(pct);
  onSplitChange?.(pct);
}
```

> **React Compiler note.** The Compiler auto-memoizes children, but it cannot
> avoid re-rendering the *owner* of per-frame state — so manual rAF/memo would
> not save us if `split` were state. Keeping `split` out of React state during a
> drag is what actually wins. The Compiler then keeps the compound subcomponents
> cheap on the rare (load / `pointerup`) renders without manual `memo`.

**2. Clip mechanism.** `clip-path: inset()` on absolutely-positioned `.After`
(GPU-composited, no layout). Reject `overflow:hidden`+`width` (layout + manual
sync). Test Safari iOS; provide a no-`clip-path` fallback that simply shows the
after image (degraded, not broken).

**3. Width measurement.** Capture `getBoundingClientRect()` once on
`pointerdown` into `widthRef` — correct under scroll/zoom/layout shift without an
observer in the hot path. No width in React state.

**4. Touch.** `touch-action: none` on the stack while dragging +
`setPointerCapture` on `pointerdown`; page scroll resumes on `pointerup`. Pointer
Events unify mouse/touch/pen. (Per `client-passive-event-listeners`: our move
handler calls `preventDefault`/captures, so it is intentionally **non-passive** —
passive listeners are only for the cases where we don't preventDefault.)

**5. Decode before `canInteract` — but never hang.** After `onLoad`, call
`img.decode()` and mark `loaded` on resolve **or reject** (rejection happens on
src swap; treat as loaded). Gate is opt-out via `decode={false}`.

**6. Preload / LCP.** Default path: before image `fetchPriority="high"` +
eager; after image normal priority, eager (no `loading="lazy"` — lazy after
causes mid-drag pop-in, violating the NFR). `asChild` hosts: document `priority`
on the before image.

**7. Compositor hint.** `will-change: clip-path` on `.After` only while
`isDragging` (toggled by the 2 state changes, not per frame); removed on release
to avoid permanent GPU layer cost.

**8. CLS.** `aspectRatio` reserves the box; `.Overlay` skeleton fills the same box.

### Accessibility

1. **Slider semantics** as in § I, with `aria-valuetext` (meaningful) and an
   **overridable `aria-label`** for localization (v1 hardcoded English).
2. **Focus only when interactive** — `tabIndex` flips with `canInteract`.
3. **Keyboard** — Arrow ±step (×5 with Shift), Home/End → min/max, committed
   immediately (low frequency, render is fine).
4. **Touch target** ≥ 44×44 via transparent expanded hit area (thin visible bar
   unchanged).
5. **Labels** — `.Label` children; if they're the only text per side, don't
   `aria-hidden`. Document WCAG AA contrast (host styles).
6. **`prefers-reduced-motion`** — disable handle transitions/snap; drag stays
   functional (reduced motion ≠ reduced interaction).
7. **v1.1 fallback (note, not built):** "Show before/after" buttons at min/max.

### SSR / hydration (new)
`'use client'`. First paint renders `style={{ '--split': defaultSplit }}` on the
server and client identically → no hydration mismatch. All imperative DOM writes
and `decode()` run post-mount. Controlled `split` also renders deterministically.

### Skip
CSS-in-JS choice, bundler, exact handle visuals — presentation, orthogonal to
clip strategy / load gating / ARIA. Virtualization + gallery orchestration stay
out of scope. `ResizeObserver` is intentionally **dropped** from core (measure
on `pointerdown` instead); add back only if a future feature renders from width.

---

## Pre-build checklist (v2)

- [ ] `CompareReveal` provider exposes `{ state, actions, meta }` via context; `use()` in parts; no `forwardRef`
- [ ] Hot path writes only `--split` on container ref; CSS `calc()` drives clip + handle; commit on `pointerup`
- [ ] `widthRef` captured on `pointerdown`; no width in state; no `ResizeObserver` in core
- [ ] Source change resets via `key`, not `useEffect`
- [ ] `asChild` Slot injects `onLoad`/`onError`/`className`/`style`/`ref`; default `<img>` fallback
- [ ] `next/image` example uses `onLoad`; before image `fetchPriority="high"`
- [ ] Best-effort `decode()` (resolve **or** reject → loaded); `decode={false}` opt-out
- [ ] Controlled mode: rAF-throttled `onSplitChange`, documented render cost
- [ ] Handle: `role="slider"`, `aria-valuetext`, overridable `aria-label`, 44px hit area, focus only when `canInteract`
- [ ] `touch-action: none` + `setPointerCapture`; click-anywhere-to-position
- [ ] `prefers-reduced-motion`: no spurious transitions
- [ ] `'use client'`; deterministic SSR first paint (`--split` = default)
```