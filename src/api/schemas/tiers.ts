import { z } from 'zod';
import { tierLimitsSchema } from './tierLimits';
import { tierSchema } from './tier';

const currencyPrices = z.object({
  premiumMonthly: z.number(),
  premiumYearly: z.number(),
  proMonthly: z.number(),
  proYearly: z.number(),
});

/** GET /api/tiers (handlers/account.go `Tiers`). */
export const tiersResponseSchema = z.object({
  tiers: z.array(z.object({ tier: tierSchema, limits: tierLimitsSchema })),
  premiumPurchasable: z.boolean(),
  proPurchasable: z.boolean(),
  defaultCurrency: z.string(),
  prices: z.object({ usd: currencyPrices, eur: currencyPrices }),
  // Deprecated since MM69 (use prices.usd); kept optional.
  premiumPriceUSD: z.number().optional(),
  premiumPriceYearlyUSD: z.number().optional(),
  proPriceUSD: z.number().optional(),
  proPriceYearlyUSD: z.number().optional(),
});

export type TiersResponse = z.infer<typeof tiersResponseSchema>;
