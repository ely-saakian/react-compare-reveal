import { CompareRevealDemo } from "./CompareRevealDemo";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            CompareReveal
          </h1>
          <p className="max-w-md text-balance text-zinc-600 dark:text-zinc-400">
            Drag the handle, click anywhere on the image, or focus it and use
            the arrow keys (Home/End to jump) to reveal the before/after.
          </p>
        </header>

        <CompareRevealDemo />
      </main>
    </div>
  );
}
