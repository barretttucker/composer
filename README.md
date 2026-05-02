This is **[WAN Composer](docs/SCOPE.md)** — a [Next.js](https://nextjs.org) app for **Forge Neo** workflows: WAN image-to-video timelines, chained clips, run snapshots, and continuity tooling.

See **`docs/SCOPE.md`** for roadmap and **`docs/specs/local-llm-integration.md`** for the KoboldCpp draft.

### Chain hygiene

Long WAN chains reuse each clip’s last frame as the next clip’s init image. That can compound softness (H.264 generation loss, weak terminal frames, repeated decoding).

Optional **chain hygiene** (project setup → **Canvas & chain** → **Chain hygiene**) runs between segments when enabled:

- Extracts an earlier frame as **uncompressed PNG** (`ffmpeg`, zlib level 0).
- Optionally applies Forge **`/sdapi/v1/extra-single-image`** at **2×** with your chosen upscaler, then **Lanczos** downscale via `ffmpeg` back to the frame size — **no checkpoint swaps**.

Defaults stay **off** (fine for short chains); turning it on often helps **four or more** chained segments.

## Getting Started

Run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command         | Purpose            |
| --------------- | ------------------ |
| `npm run dev`   | Next.js dev server |
| `npm run build` | Production build   |
| `npm run lint`  | ESLint check       |
| `npm run test`  | Vitest unit tests  |

## Deploy on Vercel

Composer is intended for local Forge workflows; deploying the Next.js shell is optional. See [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) if you host it.
