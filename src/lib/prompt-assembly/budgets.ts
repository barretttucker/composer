import type {
  AssemblyField,
  FieldBudgetEntry,
  FieldBudgets,
  Project,
} from "@/lib/schemas/project";
import { ASSEMBLY_FIELDS } from "@/lib/schemas/project";

/** Default per-field soft word budgets (spec table). */
export const DEFAULT_FIELD_BUDGETS: FieldBudgets = {
  motion: { target_min: 12, target_max: 20, soft_max: 30, hard_cap: 40 },
  beat: { target_min: 10, target_max: 18, soft_max: 25, hard_cap: 35 },
  camera: { target_min: 8, target_max: 15, soft_max: 22, hard_cap: 30 },
  setting: { target_min: 12, target_max: 25, soft_max: 35, hard_cap: 50 },
  characters: { target_min: 0, target_max: 30, soft_max: 50, hard_cap: 80 },
  style: { target_min: 5, target_max: 15, soft_max: 20, hard_cap: 30 },
  interaction: { target_min: 8, target_max: 15, soft_max: 22, hard_cap: 30 },
};

/** Assembled prompt totals (word count). */
export const TOTAL_PROMPT_TARGET_MIN = 60;
export const TOTAL_PROMPT_TARGET_MAX = 90;
export const TOTAL_PROMPT_SOFT_MAX = 110;
export const TOTAL_PROMPT_HARD_CAP = 140;

export type BudgetSeverity = "ok" | "soft" | "hard" | "capped";

export const FIELD_BUDGET_TOOLTIPS: Record<AssemblyField, string> = {
  motion:
    "Motion drives the visible action. WAN attends most strongly to the first 20-30 motion words. Longer motion descriptions tend to produce confused or jittery results.",
  beat:
    "Beat is the narrative summary. Keep it as one clear action sentence — multiple sequential actions in a single beat often produce blended motion.",
  camera:
    "Camera language is high-leverage but compact. One framing, one angle, one movement is usually optimal.",
  setting:
    "The input image already shows the setting. Setting text is reinforcement, not redefinition — keep it brief unless the scene environment changes.",
  characters:
    "Character descriptors anchor identity across chained clips. The longer, the more identity-preserving — but they consume prompt budget. Balance with image conditioning.",
  style:
    "Style applies globally to look. Stacking many style words diminishes returns; 5-10 strong style tokens beat 20 weak ones.",
  interaction:
    "Interaction describes how characters relate in-frame. Keep it focused — one clear relational action pair usually reads best.",
};

const TOTAL_CAP_TOOLTIP = `Over ${TOTAL_PROMPT_HARD_CAP} words — WAN's encoder will under-attend tokens past the effective range. Consider trimming.`;

export function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function mergeFieldBudgets(project: Project | null | undefined): FieldBudgets {
  const base = { ...DEFAULT_FIELD_BUDGETS };
  const o = project?.field_budgets;
  if (!o) return base;
  for (const k of ASSEMBLY_FIELDS) {
    const e = o[k];
    if (e) base[k] = { ...base[k]!, ...e };
  }
  return base;
}

export function budgetEntryForField(
  field: AssemblyField,
  budgets: FieldBudgets,
): FieldBudgetEntry {
  return budgets[field] ?? DEFAULT_FIELD_BUDGETS[field]!;
}

export function severityForFieldCount(
  field: AssemblyField,
  count: number,
  budgets: FieldBudgets,
): BudgetSeverity {
  const b = budgetEntryForField(field, budgets);
  if (count > b.hard_cap) return "capped";
  if (count > b.soft_max) return "hard";
  if (count > b.target_max) return "soft";
  return "ok";
}

export function severityForTotalWordCount(count: number): BudgetSeverity {
  if (count > TOTAL_PROMPT_HARD_CAP) return "capped";
  if (count > TOTAL_PROMPT_SOFT_MAX) return "hard";
  if (count > TOTAL_PROMPT_TARGET_MAX) return "soft";
  return "ok";
}

export function fieldTooltipForSeverity(
  field: AssemblyField,
  count: number,
  budgets: FieldBudgets,
): string | undefined {
  const sev = severityForFieldCount(field, count, budgets);
  if (sev !== "capped") return undefined;
  return `${count} words — WAN's encoder will under-attend tokens past ~30 words in this field. Consider trimming.`;
}

export function totalTooltipForSeverity(count: number): string | undefined {
  if (severityForTotalWordCount(count) !== "capped") return undefined;
  return `${count} words — ${TOTAL_CAP_TOOLTIP}`;
}

export function estimatedTokensFromWords(words: number): number {
  return Math.round(words * 1.3);
}
