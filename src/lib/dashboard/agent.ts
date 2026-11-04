export interface AgentConfig {
  name: string;
  personality: "Warm & empathetic" | "Calm & concise" | "Upbeat & friendly" | "Professional";
  website: string;
  brandVoice: string;
  maxDiscount: number;
  maxOffers: number;
  escalateAbove: number;
  requireApproval: boolean;
}

export const DEFAULT_AGENT: AgentConfig = { name: "Ava", personality: "Warm & empathetic", website: "", brandVoice: "", maxDiscount: 20, maxOffers: 2, escalateAbove: 300, requireApproval: true };

/** Client-side form validation only — never an authorization of financial actions. */
export function validateAgent(c: AgentConfig) {
  const e: Partial<Record<keyof AgentConfig, string>> = {};
  if (!c.name.trim()) e.name = "Give your agent a name.";
  if (c.website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(c.website.trim())) e.website = "Enter a full address starting with https://";
  if (c.brandVoice.length > 600) e.brandVoice = "Keep it under 600 characters.";
  if (c.maxDiscount < 0 || c.maxDiscount > 50) e.maxDiscount = "Discount must be between 0% and 50%.";
  if (c.maxOffers < 1 || c.maxOffers > 5) e.maxOffers = "Between 1 and 5 offers.";
  return e;
}
