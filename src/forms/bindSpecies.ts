import { z } from "zod";

/** The witness panel's bind form: the Species picked in the catalogue typeahead. */
export const bindSpeciesForm = z.object({
  group_id: z.coerce
    .number({ error: "Choose a Species from the catalogue" })
    .int()
    .positive("Choose a Species from the catalogue"),
});
