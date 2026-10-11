import * as z from "zod";

/**
 * What the approval queue's one button posts (#527): the total it showed,
 * so the lifecycle can refuse an approval of points the approver did not
 * see. There is nothing else to enter: the Witness set the points, and
 * approval computes first-time itself.
 */
export const approveForm = z.object({
  expected_total: z.coerce.number().int().nonnegative(),
});

export type ApproveFormValues = z.infer<typeof approveForm>;
