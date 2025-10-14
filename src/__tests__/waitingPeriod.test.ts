import { describe, test } from "node:test";
import assert from "node:assert";
import { getRequiredWaitingDays } from "../utils/waitingPeriod";

describe("getRequiredWaitingDays", () => {
  test("returns 30 days for marine fish", () => {
    const marineSubmission = {
      species_type: "Fish",
      species_class: "Marine",
    };
    assert.strictEqual(getRequiredWaitingDays(marineSubmission), 30);
  });

  test("returns 60 days for freshwater fish", () => {
    const freshwaterSubmission = {
      species_type: "Fish",
      species_class: "New World",
    };
    assert.strictEqual(getRequiredWaitingDays(freshwaterSubmission), 60);
  });

  test("returns 60 days for plants", () => {
    const plantSubmission = {
      species_type: "Plant",
      species_class: "Anubius",
    };
    assert.strictEqual(getRequiredWaitingDays(plantSubmission), 60);
  });

  test("returns 60 days for corals", () => {
    const coralSubmission = {
      species_type: "Coral",
      species_class: "SPS",
    };
    assert.strictEqual(getRequiredWaitingDays(coralSubmission), 60);
  });

  test("returns 60 days for inverts", () => {
    const invertSubmission = {
      species_type: "Invert",
      species_class: "Shrimp",
    };
    assert.strictEqual(getRequiredWaitingDays(invertSubmission), 60);
  });
});
