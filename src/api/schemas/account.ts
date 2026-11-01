import { z } from 'zod';
import { tierLimitsSchema } from './tierLimits';
import { tierSchema } from './tier';

/** `models.User` (internal/models/account.go). */
export const accountUserSchema = z.object({
  id: z.string(),
  firebaseUid: z.string(),
  email: z.string().optional(),
  emailVerified: z.boolean(),
  tier: tierSchema,
  tierSource: z.string(),
  tierExpiresAt: z.string().optional(),
  displayName: z.string().optional(),
  signupSource: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string().optional(),
  subscriptionStatus: z.string().optional(),
  billingInterval: z.string().optional(),
  cancelAtPeriodEnd: z.boolean(),
});

/** `usageResponse` (internal/handlers/account.go): shared by /account/me, /usage and /sync. */
export const usageResponseSchema = z.object({
  tier: tierSchema,
  limits: tierLimitsSchema,
  usage: z.record(z.string(), z.number()),
  resetsAt: z.string(),
  user: accountUserSchema.optional(),
  anonymous: z.boolean(),
  emailVerified: z.boolean(),
  operatorEligibility: z.enum(['none', 'unverified', 'granted']).optional(),
});

export type AccountUser = z.infer<typeof accountUserSchema>;
export type UsageResponse = z.infer<typeof usageResponseSchema>;

export const syncRequestSchema = z.object({
  displayName: z.string().optional(),
  signupSource: z.string().optional(),
  locale: z.string().optional(),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;
