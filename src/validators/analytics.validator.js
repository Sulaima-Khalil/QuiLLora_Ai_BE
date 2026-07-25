import { z } from 'zod';

/** Analytics schemas — the range selector on pages/Analytics.jsx. */

export const analyticsQuerySchema = {
  query: z.object({
    // Capped at a year: longer windows would scan an unbounded event set.
    days: z.coerce.number().int().min(1).max(365).default(7),
  }),
};

export default { analyticsQuerySchema };
