import { z } from "zod";
export const formQuestion = z.object({ id: z.string().max(50), label: z.string().max(2000),
  type: z.enum(["text", "paragraph", "radio", "checkbox", "select", "unsupported"]),
  required: z.boolean(), options: z.array(z.string().max(2000)).max(100) });
export const formInspection = z.object({ url: z.string(), title: z.string().max(2000), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  questions: z.array(formQuestion).min(1).max(60), singlePage: z.boolean() });
export const formAnswers = z.array(z.object({ questionId: z.string().max(50), values: z.array(z.string().max(10000)).max(100) })).min(1).max(60);
export const formDraft = z.object({ version: z.literal(1), inspection: formInspection, answers: formAnswers });
export type FormInspection = z.infer<typeof formInspection>;
export type FormAnswers = z.infer<typeof formAnswers>;

export function googleFormUrl(input: string): string {
  const u = new URL(input);
  if (u.protocol !== "https:" || u.username || u.password || u.port ||
    !(u.hostname === "forms.gle" && /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) ||
      u.hostname === "docs.google.com" && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/.test(u.pathname))) {
    throw new Error("Use a public Google Forms respondent link (viewform or forms.gle), not an editor link.");
  }
  // Only retain response-prefill fields and harmless display/language settings.
  for (const key of [...u.searchParams.keys()]) if (!/^entry\.\d+$/.test(key) && !["usp", "hl", "embedded"].includes(key)) u.searchParams.delete(key);
  u.searchParams.set("hl", "en"); u.hash = ""; return u.href;
}
export function validateFormAnswers(inspection: FormInspection, answers: FormAnswers) {
  if (!inspection.singlePage) throw new Error("Multi-page forms are not supported yet. No response was submitted.");
  const byId = new Map(answers.map(a => [a.questionId, a.values]));
  if (byId.size !== answers.length || answers.some(a => !inspection.questions.some(q => q.id === a.questionId))) throw new Error("Unknown or repeated question ID.");
  for (const q of inspection.questions) {
    const values = byId.get(q.id) ?? [];
    if (q.type === "unsupported") throw new Error(`Unsupported question: ${q.label}. No response was submitted.`);
    if (q.required && !values.some(v => v.trim())) throw new Error(`An answer is required for ${q.label}.`);
    if (q.type !== "checkbox" && values.length > 1) throw new Error("Only checkbox questions accept multiple values.");
    if (["radio", "checkbox", "select"].includes(q.type) && values.some(v => !q.options.includes(v))) throw new Error(`Choose a displayed option for ${q.label}.`);
    if (new Set(values).size !== values.length) throw new Error("Repeated answer values.");
  }
}
export function explicitFormConfirmation(message: string) {
  return /^(?:yes[,!\s]+)?(?:please\s+)?(?:submit(?:\s+(?:it|the form|this form|the draft))?(?:\s+now)?|send(?:\s+it)?|confirm|go ahead|do it|proceed|yes)[.!\s]*$/i.test(message.trim());
}
