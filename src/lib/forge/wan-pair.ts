import type { SdModelInfo } from "@/lib/forge/types";

/**
 * Best-effort WAN 2.2 pairing from checkpoint titles (high-noise / low-noise I2V/T2V).
 */
export function suggestWanCheckpointPair(models: SdModelInfo[]): {
  high?: string;
  low?: string;
} {
  const titles = models.map((m) => m.title).filter(Boolean);

  const high = titles.find((t) => {
    const x = t.toLowerCase();
    return (
      /wan\s*2[\.\s]*2|wan2\.2/i.test(x) &&
      /high|high_noise|high-noise|i2v_high/i.test(x)
    );
  });

  const low = titles.find((t) => {
    const x = t.toLowerCase();
    return (
      /wan\s*2[\.\s]*2|wan2\.2/i.test(x) &&
      /low|low_noise|low-noise|i2v_low|refiner/i.test(x)
    );
  });

  return { high, low };
}
