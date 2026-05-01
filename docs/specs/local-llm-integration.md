# WAN Composer — Local LLM Integration Spec

**Version:** 2.0  
**Status:** Design draft  
**Companion to:** WAN Composer Core Spec  
**Backend:** KoboldCpp (local only — no cloud fallback)

---

## 1. Purpose and scope

This document specifies the LLM integration layer for the WAN Composer app. It assumes the core spec (Next.js + Forge Neo orchestration, project file structure, segment timeline, run history) is already in place.

The LLM serves as a **writing assistant and prompt engineer** woven into the composer workflow. It does not replace user judgment; every LLM output is editable before it commits to a project. The LLM is opt-in and the composer must function fully without it.

**This integration is local-only by design.** All LLM inference runs on the user's own hardware via KoboldCpp. No cloud APIs, no API keys, no external network calls for LLM tasks. This is a deliberate constraint, not a temporary limitation.

### 1.1 Goals

- Convert natural-language scene descriptions into structured WAN segment scripts
- Suggest contextually-appropriate continuation prompts at run-time pause gates
- Polish rough prompts to follow WAN best practices
- Generate prompt variations for A/B exploration
- Treat KoboldCpp as the canonical and only LLM backend

### 1.2 Non-goals (v1)

- Vision-capable continuation (analyzing actual generated frames)
- Conversational interface to project state ("make segment 3 more intense")
- Fine-tuning or LoRA training of the LLM
- Real-time prompt suggestions while typing
- Cloud LLM fallback of any kind

### 1.3 Why local-only

- **Privacy:** Creative content stays on the user's hardware. Scripts, prompts, dialogue, and project metadata never leave the LAN.
- **Cost:** No usage fees. Run as many script generations and polish passes as you want.
- **Reliability:** No dependency on third-party uptime, rate limits, or pricing changes.
- **Control:** Full ownership of the model, system prompts, and inference parameters. Swap models freely.
- **Latency:** A 70B model on a local workstation typically beats a round-trip to a cloud API for short tasks, with no rate-limit throttling.

This constraint shapes several design decisions: no API key management UI, no cost tracking, no per-tier model routing for cost optimization, no fallback chains. The architecture is simpler as a result.

---

## 2. Architecture

### 2.1 LLM service module

A single module handles all LLM interactions. No abstract interface, no registry of backends — just a concrete implementation talking to KoboldCpp.

```typescript
// src/lib/llm/kobold.ts

class KoboldLLM {
  constructor(private config: KoboldConfig) {}

  async isAvailable(): Promise<boolean>
  async getLoadedModel(): Promise<string | null>

  async generateScript(input: ScriptGenerationInput): Promise<GeneratedScript>
  async suggestContinuations(input: ContinuationInput): Promise<ContinuationSuggestion[]>
  async polishPrompt(input: PolishInput): Promise<PolishedPrompt>
  async generateVariations(input: VariationInput): Promise<string[]>
  async suggestNegativePrompt(input: NegativePromptInput): Promise<string>

  // Streaming for long operations
  generateScriptStream(input: ScriptGenerationInput): AsyncIterable<ScriptStreamEvent>
}

type KoboldConfig = {
  base_url: string                // http://dogbase-alpha:5001
  chat_template: ChatTemplate     // chatml | llama3 | alpaca | mistral | auto
  default_temperature: number     // 0.7
  max_tokens: number              // 2000
  task_overrides: {
    polish: { temperature?: number, max_tokens?: number }
    variations: { temperature?: number, max_tokens?: number }
    script_generator: { temperature?: number, max_tokens?: number }
    continuation: { temperature?: number, max_tokens?: number }
    negative_prompt: { temperature?: number, max_tokens?: number }
  }
}
```

A singleton instance is created at app startup from the config file. UI components import it directly:

```typescript
import { llm } from '@/lib/llm'

const polished = await llm.polishPrompt({ rough: userInput })
```

If LLM is disabled or unreachable, methods throw `LLMUnavailableError`. UI handlers catch this and surface a "LLM unavailable — start KoboldCpp on {host}" message. No silent fallbacks.

### 2.2 Configuration

LLM config lives at `~/wan-composer/config/llm.json`:

```json
{
  "enabled": true,
  "base_url": "http://dogbase-alpha:5001",
  "chat_template": "chatml",
  "default_temperature": 0.7,
  "max_tokens": 2000,
  "task_overrides": {
    "polish": { "temperature": 0.3 },
    "variations": { "temperature": 0.9 },
    "script_generator": { "temperature": 0.7 },
    "continuation": { "temperature": 0.6 },
    "negative_prompt": { "temperature": 0.5 }
  },
  "connection": {
    "timeout_ms": 30000,
    "first_call_timeout_ms": 60000,
    "retry_attempts": 3,
    "retry_backoff_ms": 1000
  }
}
```

The `enabled` flag lets users disable the LLM entirely (composer falls back to manual-only mode). No model name, no API key, no provider selection — KoboldCpp serves whatever model the user has loaded on their server, and the composer reads that name from `/v1/models` for display purposes only.

---

## 3. KoboldCpp backend implementation

### 3.1 API selection

KoboldCpp exposes both its native KoboldAI API and an OpenAI-compatible endpoint at `/v1/chat/completions`. **Use the OpenAI-compatible endpoint** — it's the cleanest path and well-documented.

Endpoints used:

- `POST /v1/chat/completions` — all generation tasks (with `stream: true` for script gen)
- `GET /v1/models` — discover what model is loaded, surface in UI
- `GET /api/v1/info/version` — health check on connection

### 3.2 Chat template handling

Different model families need different turn delimiters. Hermes-3 uses ChatML; Llama-3 instruct uses its own format; Alpaca-style models use yet another. Getting this wrong produces output that looks plausible but is degraded.

Supported templates in v1:

```typescript
type ChatTemplate =
  | 'chatml'           // <|im_start|>system...
  | 'llama3'
  | 'alpaca'           // ### Instruction:\n...\n### Response:
  | 'mistral'          // [INST] ... [/INST]
  | 'auto'             // detect from model name string returned by /v1/models
```

The OpenAI-compatible endpoint should handle templating server-side based on KoboldCpp's loaded model, but in practice it sometimes guesses wrong — particularly for community fine-tunes that don't match the base model's expected template. The composer's `chat_template` config is the authoritative override.

A `ChatTemplateApplier` utility takes role-tagged messages and a template name, returns the formatted prompt string. This is independent of the LLM service and unit-testable. When the user explicitly sets a template in config, the composer bypasses Kobold's auto-detection by sending raw `prompt` to `/api/v1/generate` instead of the chat endpoint.

The auto-detect rules are simple regex on the model name string:

```typescript
const AUTODETECT_RULES = [
  { pattern: /hermes-?3|nous-hermes-3/i, template: 'chatml' },
  { pattern: /llama-?3.*instruct/i, template: 'llama3' },
  { pattern: /mistral.*instruct|mixtral/i, template: 'mistral' },
  { pattern: /alpaca|vicuna|wizardlm/i, template: 'alpaca' },
  // fallback
  { pattern: /.*/, template: 'chatml' }  // most modern models work with ChatML
]
```

### 3.3 JSON output reliability

KoboldCpp doesn't enforce JSON output server-side. The composer enforces it client-side via prompting + retry loop:

```typescript
async function generateJSON<T>(
  schemaName: string,
  systemPrompt: string,
  userPrompt: string,
  validator: (raw: unknown) => T,
  maxRetries = 3
): Promise<T> {
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]

  let lastError: Error | null = null
  let lastResponse: string | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (lastError && lastResponse) {
      messages.push(
        { role: 'assistant', content: lastResponse },
        {
          role: 'user',
          content: `Your previous response was not valid JSON for the ${schemaName} schema. Specifically: ${lastError.message}. Please respond with ONLY a valid JSON object matching the schema, with no other text, no markdown fences, no commentary.`
        }
      )
    }

    const raw = await this.complete(messages)
    const cleaned = stripMarkdownFences(raw).trim()

    try {
      const parsed = JSON.parse(cleaned)
      return validator(parsed)  // throws if schema invalid
    } catch (e) {
      lastError = e as Error
      lastResponse = raw
      continue
    }
  }

  throw new LLMOutputError(
    `Failed to produce valid ${schemaName} JSON after ${maxRetries} attempts. ` +
    `Last error: ${lastError?.message}. Consider editing the system prompt or ` +
    `lowering temperature for this task.`
  )
}
```

Validators use Zod schemas. Failed JSON parsing is logged with the raw response so the user can see what went wrong. There's a "View last LLM call" debug panel in settings that shows the last request/response pair for troubleshooting.

**Future option: GBNF grammars.** KoboldCpp supports GBNF constrained generation for guaranteed JSON. Not in v1 because it requires per-task grammar files and adds complexity; worth revisiting in v2 if any task exceeds ~5% JSON failure rates.

### 3.4 Streaming

Kobold supports SSE on `/v1/chat/completions` with `stream: true`. Used for script generation only (the user-visible long operation). Other tasks return synchronously.

Stream events are passed through to the UI as:

```typescript
type ScriptStreamEvent =
  | { type: 'token', content: string }
  | { type: 'segment_complete', segment: GeneratedSegment, index: number }
  | { type: 'done', script: GeneratedScript }
  | { type: 'error', error: string }
```

The orchestrator parses streamed JSON incrementally — when it detects a complete segment object in the stream, it emits `segment_complete` so the UI can show segments populating one at a time. This requires a stateful JSON streaming parser; ship a small one rather than depending on a third-party streaming JSON library.

### 3.5 Connection management

- On app startup: ping `/api/v1/info/version`, fetch loaded model from `/v1/models`
- On disconnect: degraded mode; "LLM unavailable" in UI top bar
- Auto-retry on transient failures (3 retries, exponential backoff)
- Manual reconnect via top-bar button

Kobold's first request after a long idle can be slow — first call timeout 60s, then normal timeout within a 5-minute window.

### 3.6 No queueing in v1

Single-user app, single Kobold backend; concurrent calls queue naturally on Kobold. Optional later: in-flight tracker to disable LLM-triggering UI until completion.

---

## 4. System prompts and prompt engineering

### 4.1 File layout

```
~/wan-composer/llm/
├── system_prompts/
│   ├── script_generator/
│   ├── continuation/
│   ├── polish/
│   ├── variations/
│   └── negative_prompt/
├── few_shot_examples/
│   ├── script_examples.jsonl
│   ├── polish_examples.jsonl
│   └── continuation_examples.jsonl
└── wan_prompting_guide.md
```

Plain text; power users encouraged to version in Git externally.

### 4.2 Shared knowledge base

`wan_prompting_guide.md` is the canonical document on WAN prompting best practices. It is injected into every system prompt as context. Contents (condensed):

- Prompt structure: subject + action + interaction + camera + lighting + setting
- Word count guidance (20–40 for I2V, 60–80 for T2V)
- For I2V: don't re-describe what's in the image; focus on motion
- Camera language vocabulary (dolly, pan, handheld, static, over-shoulder, etc.)
- Lighting vocabulary (warm tungsten, golden hour, overcast, hard side-lighting, neon, etc.)
- Anti-patterns (vague action verbs, conflicting time-of-day descriptors, multiple sequential actions)
- Drift mitigation (action coming to rest at end of clip, etc.)

This is a living document. Users can edit it; their edits propagate to all LLM tasks on the next call (no app restart required).

### 4.3 Script generator system prompt structure

```
You are a video script generator for the WAN 2.2 video model running in Forge Neo.
Your job: convert natural-language scene descriptions into structured per-segment
prompts following WAN best practices.

## WAN Prompting Guide
{INJECTED: wan_prompting_guide.md}

## Output schema
You MUST output valid JSON matching this schema, with no other text:
{
  "segments": [
    {
      "prompt": string,
      "frames": int,
      "notes": string,
      "suggested_seed": int|null
    }
  ],
  "scene_summary": string,
  "estimated_duration_seconds": float
}

## Constraints
- Each segment is 3–5 seconds (49–81 frames at 16 fps)
- Total segment count between {min_segments} and {max_segments}
- This is image-to-video: the user has a starting image. Don't re-describe
  characters' appearance; focus on motion, camera, and atmosphere.
- For chained segments (after the first), prompt should connect naturally to
  the previous segment's ending state.
- The last segment should resolve cleanly (action coming to rest), not
  cliffhang, unless the user explicitly asks for an open ending.

## Examples
{INJECTED: 3–5 few-shot examples from script_examples.jsonl}

## User input format
The user will provide:
- A scene description in plain language
- A target total duration in seconds
- An optional style hint (cinematic, naturalistic, animated, etc.)
- An optional number of beats (or "auto")

Now process the user's request. Output ONLY the JSON, no preamble.
```

### 4.4 Few-shot examples

Critical for output quality. JSONL format: each line is an `{input, output}` pair.

```jsonl
{"input": {"description": "...", "target_seconds": 12, "style": "cinematic", "num_beats": "auto"}, "output": {"segments": [...]}}
```

Ship 5–7 quality examples per task, diverse scenes. Users can add their own; they get appended at runtime.

Learning loop (post-core): projects marked **good output** → offer adding as few-shot; builds personalized prompt data locally.

### 4.5 Continuation suggester system prompt

```
You are helping continue a video that's being generated segment-by-segment.
The user is at a pause point and needs to decide what happens next.

## WAN Prompting Guide
{INJECTED: wan_prompting_guide.md}

## Context you have
- All previous segments' prompts (in order)
- The textual description of where the action paused
- Total target duration and segments completed so far
- The user's optional steering hint

## Your task
Generate {N} candidate continuation prompts. Each should:
- Flow naturally from where the previous segment ended
- Offer a different direction (don't generate 3 near-identical prompts)
- Follow WAN prompting best practices
- Be 20–40 words for I2V

## Output schema
{
  "candidates": [
    {
      "label": string,
      "prompt": string,
      "rationale": string
    }
  ]
}

Output ONLY the JSON.
```

The `label` field powers labeled buttons in the UI; `prompt` tooltip/preview; `rationale` when expanded.

### 4.6 Polish prompt system prompt

```
You are a prompt editor for WAN 2.2 video generation. The user has written a
rough prompt and wants it polished to follow best practices.

## WAN Prompting Guide
{INJECTED: wan_prompting_guide.md}

## Your task
Rewrite the user's prompt:
- Preserve their intent and creative direction exactly
- Add camera language if missing (one camera move max)
- Add lighting language if missing
- Tighten language; remove filler
- For I2V: remove static appearance descriptions if user marked this as I2V

## Output schema
{
  "polished_prompt": string,
  "changes_made": [string]
}

Be conservative — don't add details the user didn't imply. If the prompt is
already good, return it unchanged with changes_made: ["No changes needed; prompt
already follows best practices."]

Output ONLY the JSON.
```

The `changes_made` field supports review and rejecting polish that overreached.

---

## 5. UI integration

### 5.1 LLM status indicator

Top bar states (textual):

- **Connected:** `{model}` (Kobold @ `{host}`) — connected, ready
- **Connecting** — reconnecting after blip
- **Unavailable** — disabled or unreachable; `[Configure]` link

Click expands: URL, loaded model, last latency/time, reconnect, Settings.

### 5.2 Scene composer wizard

“Generate from description” / “Add segments” — modal with description, duration, style, beats, Advanced (temperature, optional custom system prompt); streaming review with per-segment Edit, Regenerate, Accept.

### 5.3 Per-segment AI assist

Segment cards: **Polish**, **Variations**, **Continue** (last segment only). Disabled with tooltip when LLM unavailable.

### 5.4 Pause-gate continuation panel

Suggestions as cards with label, prompt, rationale; custom textarea fallback. If LLM down: plain textarea only — run never blocked.

### 5.5 Settings — LLM

Enable toggle, Kobold URL, loaded model auto-detected, chat template, test connection, defaults and per-task overrides, links to edit system prompts (Markdown/Monaco), reset defaults, debug (last LLM request/response, session history).

---

## 6. Interaction with run orchestrator

### 6.1 Run options

```typescript
type RunOptions = {
  // ... existing core fields ...

  llm?: {
    use_continuation_suggestions: boolean // default true
    auto_polish_on_segment_create: boolean // default false
    drift_check_with_llm: boolean         // v2
  }
}
```

### 6.2 Resumable runs

Continuation suggestions cached under `runs/run_NNN/llm_cache/` keyed by `(task, segment_id, prompt_hash)`. “Regenerate suggestions” forces refresh.

### 6.3 Usage tracking (informational)

`RunLLMStats`: totals and `calls_by_task`, `failed_json_parses` for tuning/Grammar reconsideration later.

---

## 7. Cool extensions (post-v1)

Prioritized backlog: style transfer prompts, director’s notes, project templates from prompt, embedding similarity search (7.4), dialogue + TTS (7.5), self-improvement A/B tracking (7.6), multi-tier local routing (7.7), conversational project UX (7.8).

---

## 8. Implementation phasing

1. **Foundation:** Kobold module, templates, JSON retry, status indicator, Settings, **polish only**
2. **Core writing:** Continuations at pause gates, prompting guide + few-shots, prompt editing in Settings
3. **Script generation:** Streaming wizard, regeneration, variations, negative prompt
4. **Power:** Style transfer flows, feedback loop, templates, stats
5. **Long-term:** Search, dialogue routing, multi-backend, conversational projects

---

## 9. Testing strategy

Schema tests with fixtures; mocked Kobold for retry/streaming parsers; manual/nightly Kobold-required regression harness; frozen expected outputs optional.

---

## 10. Open questions

1. Embedded vs lazy few-shot data
2. Multi-user shared Kobold — not v1
3. `~/wan-composer/llm/` under Git — recommend practice
4. Vision continuation — v2+
5. GBNF vs retries — defer until measured failure rates

---

## Appendix A: Reference Kobold call

Minimal streaming example (same as original Appendix A):

```typescript
async function generateScriptStreamed(
  baseUrl: string,
  systemPrompt: string,
  userInput: string
): Promise<AsyncIterable<string>> {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kobold-loaded-model',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      stream: true
    })
  })

  return parseSSEStream(response.body!)
}

async function* parseSSEStream(stream: ReadableStream): AsyncIterable<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return

      try {
        const json = JSON.parse(data)
        const token = json.choices?.[0]?.delta?.content
        if (token) yield token
      } catch {
        // malformed chunk, skip
      }
    }
  }
}
```

---

## Appendix B: Anti-goals

- Not auto-approve; always user review before commit  
- Not a replacement for creative direction  
- Not a hallucinated “quality score”  
- Not cloud-augmented  
- Not trainer for weights — prompt composition only

---

*End of spec*
