import type { GenerationParams } from "@/lib/schemas/project";

export type VideoGenerateInput = {
  generation: GenerationParams;
  prompt: string;
  negativePrompt: string;
  initImageBase64: string;
};

export type VideoGenerateResult = {
  videoBase64: string;
  seedUsed: number;
  requestPayload: Record<string, unknown>;
};

export interface VideoBackend {
  generate(input: VideoGenerateInput): Promise<VideoGenerateResult>;
}
