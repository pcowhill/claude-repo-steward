import { z } from 'zod';
import { ActionProposalSchema, RiskLevelSchema } from './proposals';

/**
 * Analyzer output shapes shared by all three modes, plus the wire format the
 * Live AI backend returns (drafts without ids — the client stamps identity).
 */

export const ClassificationSchema = z.object({
  type: z.enum(['bug', 'feature', 'question', 'docs', 'chore', 'unknown']),
  confidence: z.number().min(0).max(1),
});

export const ReadinessSchema = z.object({
  /** 0–1 definition-of-ready completeness. */
  score: z.number().min(0).max(1),
  missing: z.array(z.string()),
});

export const AnalysisResultSchema = z.object({
  eventId: z.string(),
  mode: z.enum(['scripted', 'mock', 'live']),
  summary: z.string(),
  classification: ClassificationSchema.nullable(),
  impact: z.string().nullable(),
  readiness: ReadinessSchema.nullable(),
  evidence: z.array(z.string()),
  proposals: z.array(ActionProposalSchema),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/**
 * What a live model is asked to produce. Deliberately narrower than the full
 * proposal schema: no ids, no timestamps, no analyzer mode — identity and
 * provenance are stamped by our code, never by the model.
 */
export const ProposalDraftSchema = z.object({
  actionType: z.string(),
  title: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema,
  payload: z.record(z.unknown()).default({}),
});
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

export const LiveAnalysisResponseSchema = z.object({
  summary: z.string().min(1),
  classification: ClassificationSchema.nullable().default(null),
  impact: z.string().nullable().default(null),
  readiness: ReadinessSchema.nullable().default(null),
  evidence: z.array(z.string()).default([]),
  proposals: z.array(ProposalDraftSchema).default([]),
});
export type LiveAnalysisResponse = z.infer<typeof LiveAnalysisResponseSchema>;

/** The seven visible pipeline stages shown while a run is in flight. */
export const PIPELINE_STEPS = [
  { id: 'normalize', label: 'Normalizing repository event' },
  { id: 'context', label: 'Gathering relevant context' },
  { id: 'analyze', label: 'Analyzing issue or pull request' },
  { id: 'proposals', label: 'Building structured proposals' },
  { id: 'policy', label: 'Evaluating team policy' },
  { id: 'execute', label: 'Applying permitted actions' },
  { id: 'audit', label: 'Recording audit evidence' },
] as const;

export type PipelineStepId = (typeof PIPELINE_STEPS)[number]['id'];
