import "server-only";

import type { AppProfile } from "@/lib/app-config/profiles";
import {
  createForgeClient,
  mapParamsToForgeImg2Img,
  type CreateForgeClientOptions,
} from "@/lib/forge/client";
import type { VideoBackend, VideoGenerateInput, VideoGenerateResult } from "./types";

export type ForgeNeoClient = ReturnType<typeof createForgeClient>;

export function forgeNeoBackendFromClient(client: ForgeNeoClient): VideoBackend {
  return {
    async generate(input: VideoGenerateInput): Promise<VideoGenerateResult> {
      const { payload, seedUsed } = mapParamsToForgeImg2Img({
        generation: input.generation,
        initImageBase64: input.initImageBase64,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
      });
      const { videoBase64 } = await client.img2img(payload);
      return { videoBase64, seedUsed, requestPayload: payload };
    },
  };
}

export function createForgeNeoVideoBackend(
  profile: AppProfile,
  forgeOptions?: CreateForgeClientOptions,
): { client: ForgeNeoClient; backend: VideoBackend } {
  const client = createForgeClient(profile, forgeOptions);
  return { client, backend: forgeNeoBackendFromClient(client) };
}
