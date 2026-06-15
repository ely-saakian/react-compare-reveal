# CompareReveal

An accessible, high-performance before/after image reveal component for React 19. Drag hot path writes only a CSS variable (`--split`) — no `setState` per frame — so image layers and the handle stay off the render path during gestures.

## Install

Requires a [shadcn/ui](https://ui.shadcn.com) project (Tailwind v4, `cn` from `@/lib/utils`).

```bash
npx shadcn@latest add ely-saakian/react-compare-reveal/component
```

Pin to a release:

```bash
npx shadcn@latest add ely-saakian/react-compare-reveal/component#v0.1.0
```

**Requirements:** React 19+ (uses the `use()` hook and context-as-provider).

## Flat API

Pass `beforeSrc` / `afterSrc` and optional labels. The component builds the compound tree internally.

```tsx
import { CompareReveal } from "@/components/compare-reveal";

<CompareReveal
  beforeSrc="/before.webp"
  afterSrc="/after.jpg"
  beforeAlt="Before"
  afterAlt="After"
  beforeLabel="Before"
  afterLabel="After"
  aspectRatio={16 / 9}
  defaultSplit={50}
  onSplitChange={(pct) => console.log(pct)}
  className="w-full rounded-2xl"
/>
```

Controlled mode: pass `split` and `onSplitChange`.

## Compound API

Compose parts directly. Use `asChild` to slot in `next/image` or any `<img>`-like element.

```tsx
import Image from "next/image";
import { CompareReveal } from "@/components/compare-reveal";

<CompareReveal defaultSplit={50} aspectRatio={16 / 9} className="w-full rounded-2xl">
  <CompareReveal.Before asChild>
    <Image src="/before.webp" alt="Before" fill sizes="100vw" priority />
  </CompareReveal.Before>

  <CompareReveal.After asChild>
    <Image src="/after.jpg" alt="After" fill sizes="100vw" />
  </CompareReveal.After>

  <CompareReveal.Label slot="before">Before</CompareReveal.Label>
  <CompareReveal.Label slot="after">After</CompareReveal.Label>

  <CompareReveal.Handle />

  <CompareReveal.Overlay
    loadingContent={<span>Loading…</span>}
    errorContent="Failed to load images."
  />
</CompareReveal>
```

## Parts

| Part | Role |
| --- | --- |
| `CompareReveal` | Root provider + interactive container |
| `CompareReveal.Before` | Before image layer |
| `CompareReveal.After` | After image layer (clip-path reveal) |
| `CompareReveal.Handle` | Draggable slider + keyboard control |
| `CompareReveal.Label` | Corner label badge |
| `CompareReveal.Overlay` | Loading skeleton / error state |

## Hooks

`useCompareReveal()` reads full context (state + actions + meta). Image slots use internal wiring only — they do not re-render on drag commits.

## Demo

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) for live flat and compound examples.

## License

MIT
