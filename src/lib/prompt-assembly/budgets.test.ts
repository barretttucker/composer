import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIELD_BUDGETS,
  mergeFieldBudgets,
  severityForFieldCount,
  severityForTotalWordCount,
} from "@/lib/prompt-assembly/budgets";
import type { Project } from "@/lib/schemas/project";

describe("budgets", () => {
  it("classifies field thresholds", () => {
    const b = DEFAULT_FIELD_BUDGETS;
    expect(severityForFieldCount("motion", 15, b)).toBe("ok");
    expect(severityForFieldCount("motion", 25, b)).toBe("soft");
    expect(severityForFieldCount("motion", 35, b)).toBe("hard");
    expect(severityForFieldCount("motion", 45, b)).toBe("capped");
  });

  it("classifies total thresholds", () => {
    expect(severityForTotalWordCount(70)).toBe("ok");
    expect(severityForTotalWordCount(95)).toBe("soft");
    expect(severityForTotalWordCount(120)).toBe("hard");
    expect(severityForTotalWordCount(150)).toBe("capped");
  });

  it("merges project overrides", () => {
    const p = {
      field_budgets: { motion: { target_min: 1, target_max: 2, soft_max: 3, hard_cap: 4 } },
    } as unknown as Project;
    const m = mergeFieldBudgets(p);
    expect(m.motion.target_min).toBe(1);
    expect(m.beat.target_min).toBe(DEFAULT_FIELD_BUDGETS.beat.target_min);
  });
});
