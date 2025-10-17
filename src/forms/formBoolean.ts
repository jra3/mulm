import { z } from "zod";

/**
 * Helper for handling form checkboxes that use the hidden input trick
 * Accepts either a string ('0' or '1') or array (['0', '1']) and converts to boolean
 *
 * Usage:
 * const schema = z.object({
 *   my_checkbox: formBoolean(),
 * });
 */
export function formBoolean() {
  return z.preprocess((val) => {
    // Handle undefined (field not in form)
    if (val === undefined) return false;
    // If array (hidden + checkbox both sent), take last value
    if (Array.isArray(val)) {
      return val[val.length - 1] === "1";
    }
    // If string
    return val === "1";
  }, z.boolean());
}
