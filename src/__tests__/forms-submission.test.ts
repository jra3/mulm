import { describe, test } from "node:test";
import assert from "node:assert";
import {
  isLivestock,
  hasFoods,
  hasSpawnLocations,
  hasLighting,
  hasSupplements,
  getBapFormTitle,
  getClassOptions,
  bapFields,
  bapForm,
  bapDraftForm,
  speciesTypesAndClasses,
  foodTypes,
  spawnLocations,
  speciesTypes,
  waterTypes,
} from "../forms/submission";

// Base valid submission data for Fish (livestock) type
function validFishData() {
  return {
    water_type: "Fresh",
    species_type: "Fish",
    reproduction_date: "2026-01-15",
    species_class: "Cichlids - New World",
    species_latin_name: "Apistogramma cacatuoides",
    species_common_name: "Cockatoo Dwarf Cichlid",
    count: "20",
    foods: ["Live", "Frozen"],
    spawn_locations: ["Cave"],
    tank_size: "20 gallon",
    filter_type: "Sponge filter",
    water_change_volume: "25%",
    water_change_frequency: "Weekly",
    temperature: "78F",
    ph: "6.8",
    substrate_type: "Sand",
    substrate_depth: "2 inches",
    substrate_color: "Natural",
  };
}

function validInvertData() {
  return {
    ...validFishData(),
    species_type: "Invert",
    species_class: "Shrimp",
    species_latin_name: "Neocaridina davidi",
    species_common_name: "Cherry Shrimp",
  };
}

function validPlantData() {
  return {
    water_type: "Fresh",
    species_type: "Plant",
    reproduction_date: "2026-01-15",
    species_class: "Stem Plants",
    species_latin_name: "Rotala rotundifolia",
    species_common_name: "Roundleaf Toothcup",
    propagation_method: "Stem cutting",
    light_type: "LED",
    light_strength: "High",
    light_hours: "8",
    tank_size: "20 gallon",
    filter_type: "Canister",
    water_change_volume: "30%",
    water_change_frequency: "Weekly",
    temperature: "76F",
    ph: "6.5",
    substrate_type: "Aquasoil",
    substrate_depth: "3 inches",
    substrate_color: "Dark brown",
  };
}

function validCoralData() {
  return {
    water_type: "Salt",
    species_type: "Coral",
    reproduction_date: "2026-01-15",
    species_class: "Hard",
    species_latin_name: "Acropora millepora",
    species_common_name: "Millepora Acropora",
    foods: ["Phytoplankton", "Reef Roids"],
    propagation_method: "Fragging",
    light_type: "LED",
    light_strength: "High",
    light_hours: "10",
    tank_size: "75 gallon",
    filter_type: "Protein skimmer",
    water_change_volume: "10%",
    water_change_frequency: "Weekly",
    temperature: "78F",
    ph: "8.2",
    substrate_type: "Live sand",
    substrate_depth: "2 inches",
    substrate_color: "White",
  };
}

// ─── Helper Functions ────────────────────────────────────────────────

void describe("isLivestock", () => {
  void test("returns true for Fish", () => {
    assert.strictEqual(isLivestock("Fish"), true);
  });

  void test("returns true for Invert", () => {
    assert.strictEqual(isLivestock("Invert"), true);
  });

  void test("returns false for Plant", () => {
    assert.strictEqual(isLivestock("Plant"), false);
  });

  void test("returns false for Coral", () => {
    assert.strictEqual(isLivestock("Coral"), false);
  });

  void test("returns false for unknown type", () => {
    assert.strictEqual(isLivestock("Unknown"), false);
  });
});

void describe("hasFoods", () => {
  void test("returns true for Fish", () => {
    assert.strictEqual(hasFoods("Fish"), true);
  });

  void test("returns true for Invert", () => {
    assert.strictEqual(hasFoods("Invert"), true);
  });

  void test("returns true for Coral", () => {
    assert.strictEqual(hasFoods("Coral"), true);
  });

  void test("returns false for Plant", () => {
    assert.strictEqual(hasFoods("Plant"), false);
  });
});

void describe("hasSpawnLocations", () => {
  void test("returns true for Fish", () => {
    assert.strictEqual(hasSpawnLocations("Fish"), true);
  });

  void test("returns true for Invert", () => {
    assert.strictEqual(hasSpawnLocations("Invert"), true);
  });

  void test("returns false for Plant", () => {
    assert.strictEqual(hasSpawnLocations("Plant"), false);
  });

  void test("returns false for Coral", () => {
    assert.strictEqual(hasSpawnLocations("Coral"), false);
  });
});

void describe("hasLighting", () => {
  void test("returns true for Plant", () => {
    assert.strictEqual(hasLighting("Plant"), true);
  });

  void test("returns true for Coral", () => {
    assert.strictEqual(hasLighting("Coral"), true);
  });

  void test("returns false for Fish", () => {
    assert.strictEqual(hasLighting("Fish"), false);
  });

  void test("returns false for Invert", () => {
    assert.strictEqual(hasLighting("Invert"), false);
  });
});

void describe("hasSupplements", () => {
  void test("returns true for Plant", () => {
    assert.strictEqual(hasSupplements("Plant"), true);
  });

  void test("returns true for Coral", () => {
    assert.strictEqual(hasSupplements("Coral"), true);
  });

  void test("returns false for Fish", () => {
    assert.strictEqual(hasSupplements("Fish"), false);
  });

  void test("returns false for Invert", () => {
    assert.strictEqual(hasSupplements("Invert"), false);
  });
});

// ─── getBapFormTitle ─────────────────────────────────────────────────

void describe("getBapFormTitle", () => {
  void test("returns Breeder Awards Submission for Fish", () => {
    assert.strictEqual(getBapFormTitle("Fish"), "Breeder Awards Submission");
  });

  void test("returns Breeder Awards Submission for Invert", () => {
    assert.strictEqual(getBapFormTitle("Invert"), "Breeder Awards Submission");
  });

  void test("returns Horticultural Awards Submission for Plant", () => {
    assert.strictEqual(getBapFormTitle("Plant"), "Horticultural Awards Submission");
  });

  void test("returns Coral Awards Submission for Coral", () => {
    assert.strictEqual(getBapFormTitle("Coral"), "Coral Awards Submission");
  });

  void test("returns Breeder Awards Submission for unknown type (default)", () => {
    assert.strictEqual(getBapFormTitle("Unknown"), "Breeder Awards Submission");
  });
});

// ─── getClassOptions ─────────────────────────────────────────────────

void describe("getClassOptions", () => {
  void test("returns Fish class options in value/text format", () => {
    const options = getClassOptions("Fish");
    assert.ok(options.length > 0);
    assert.deepStrictEqual(options[0], { value: "Anabantoids", text: "Anabantoids" });
    assert.strictEqual(options.length, speciesTypesAndClasses["Fish"].length);
  });

  void test("returns Invert class options", () => {
    const options = getClassOptions("Invert");
    assert.deepStrictEqual(options, [
      { value: "Snail", text: "Snail" },
      { value: "Shrimp", text: "Shrimp" },
      { value: "Other", text: "Other" },
    ]);
  });

  void test("returns Plant class options", () => {
    const options = getClassOptions("Plant");
    assert.strictEqual(options.length, speciesTypesAndClasses["Plant"].length);
  });

  void test("returns Coral class options", () => {
    const options = getClassOptions("Coral");
    assert.deepStrictEqual(options, [
      { value: "Hard", text: "Hard" },
      { value: "Soft", text: "Soft" },
    ]);
  });

  void test("returns empty array for unknown species type", () => {
    const options = getClassOptions("Unknown");
    assert.deepStrictEqual(options, []);
  });
});

// ─── Exported Constants ──────────────────────────────────────────────

void describe("exported constants", () => {
  void test("speciesTypes has all four types", () => {
    assert.deepStrictEqual(speciesTypes, ["Fish", "Invert", "Plant", "Coral"]);
  });

  void test("waterTypes has all three types", () => {
    assert.deepStrictEqual(waterTypes, ["Fresh", "Brackish", "Salt"]);
  });

  void test("foodTypes is non-empty array of strings", () => {
    assert.ok(foodTypes.length > 0);
    for (const f of foodTypes) {
      assert.strictEqual(typeof f, "string");
    }
  });

  void test("spawnLocations is non-empty array of strings", () => {
    assert.ok(spawnLocations.length > 0);
    for (const s of spawnLocations) {
      assert.strictEqual(typeof s, "string");
    }
  });
});

// ─── bapFields Base Schema ───────────────────────────────────────────

void describe("bapFields", () => {
  void test("parses valid Fish data", () => {
    const result = bapFields.safeParse(validFishData());
    assert.strictEqual(result.success, true);
  });

  void test("parses valid Plant data", () => {
    const result = bapFields.safeParse(validPlantData());
    assert.strictEqual(result.success, true);
  });

  void test("parses valid Coral data", () => {
    const result = bapFields.safeParse(validCoralData());
    assert.strictEqual(result.success, true);
  });

  void test("transforms string id to number", () => {
    const data = { ...validFishData(), id: "42" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.id, 42);
    }
  });

  void test("transforms undefined id to undefined", () => {
    const result = bapFields.safeParse(validFishData());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.id, undefined);
    }
  });

  void test("transforms string member_id to number", () => {
    const data = { ...validFishData(), member_id: "7" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.member_id, 7);
    }
  });

  void test("rejects invalid water_type", () => {
    const data = { ...validFishData(), water_type: "Distilled" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects invalid species_type", () => {
    const data = { ...validFishData(), species_type: "Reptile" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty reproduction_date", () => {
    const data = { ...validFishData(), reproduction_date: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects invalid reproduction_date", () => {
    const data = { ...validFishData(), reproduction_date: "not-a-date" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty species_class", () => {
    const data = { ...validFishData(), species_class: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty species_latin_name", () => {
    const data = { ...validFishData(), species_latin_name: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty species_common_name", () => {
    const data = { ...validFishData(), species_common_name: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty tank_size", () => {
    const data = { ...validFishData(), tank_size: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty filter_type", () => {
    const data = { ...validFishData(), filter_type: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects too-long species_latin_name", () => {
    const data = { ...validFishData(), species_latin_name: "x".repeat(201) };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("rejects too-long notes", () => {
    const data = { ...validFishData(), notes: "x".repeat(2001) };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("accepts valid video_url", () => {
    const data = { ...validFishData(), video_url: "https://youtube.com/watch?v=abc" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("rejects invalid video_url", () => {
    const data = { ...validFishData(), video_url: "not-a-url" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("accepts empty string video_url", () => {
    const data = { ...validFishData(), video_url: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("accepts valid article_link", () => {
    const data = { ...validFishData(), article_link: "https://example.com/article" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("accepts empty string article_link", () => {
    const data = { ...validFishData(), article_link: "" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("accepts member_name and member_email", () => {
    const data = { ...validFishData(), member_name: "John", member_email: "john@example.com" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("rejects invalid member_email", () => {
    const data = { ...validFishData(), member_email: "not-email" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });

  void test("normalizes single food string to array via multiSelect", () => {
    const data = { ...validFishData(), foods: "Live" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.foods, ["Live"]);
    }
  });

  void test("accepts foods as array", () => {
    const data = { ...validFishData(), foods: ["Live", "Frozen"] };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.foods, ["Live", "Frozen"]);
    }
  });

  void test("accepts co2 yes/no enum", () => {
    const dataYes = { ...validFishData(), co2: "yes" };
    const dataNo = { ...validFishData(), co2: "no" };
    assert.strictEqual(bapFields.safeParse(dataYes).success, true);
    assert.strictEqual(bapFields.safeParse(dataNo).success, true);
  });

  void test("rejects invalid co2 value", () => {
    const data = { ...validFishData(), co2: "maybe" };
    const result = bapFields.safeParse(data);
    assert.strictEqual(result.success, false);
  });
});

// ─── bapDraftForm (partial) ──────────────────────────────────────────

void describe("bapDraftForm", () => {
  void test("accepts completely empty object", () => {
    const result = bapDraftForm.safeParse({});
    assert.strictEqual(result.success, true);
  });

  void test("accepts partial data with only species_type", () => {
    const result = bapDraftForm.safeParse({ species_type: "Fish" });
    assert.strictEqual(result.success, true);
  });

  void test("accepts partial data with a few fields", () => {
    const result = bapDraftForm.safeParse({
      water_type: "Fresh",
      species_type: "Plant",
      species_latin_name: "Rotala rotundifolia",
    });
    assert.strictEqual(result.success, true);
  });

  void test("still validates provided field values", () => {
    const result = bapDraftForm.safeParse({ species_type: "Reptile" });
    assert.strictEqual(result.success, false);
  });

  void test("still validates email format when provided", () => {
    const result = bapDraftForm.safeParse({ member_email: "bad-email" });
    assert.strictEqual(result.success, false);
  });
});

// ─── bapForm Refine Chains (Species-Type-Dependent Required Fields) ──

void describe("bapForm refine chains", () => {
  void describe("Fish submissions", () => {
    void test("passes with complete valid Fish data", () => {
      const result = bapForm.safeParse(validFishData());
      assert.strictEqual(result.success, true);
    });

    void test("requires count for Fish", () => {
      const data = { ...validFishData(), count: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const countError = result.error.issues.find((i) => i.path.includes("count"));
        assert.ok(countError, "Expected error on count field");
      }
    });

    void test("requires foods for Fish", () => {
      const data = { ...validFishData(), foods: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const foodsError = result.error.issues.find((i) => i.path.includes("foods"));
        assert.ok(foodsError, "Expected error on foods field");
      }
    });

    void test("requires spawn_locations for Fish", () => {
      const data = { ...validFishData(), spawn_locations: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const spawnError = result.error.issues.find((i) => i.path.includes("spawn_locations"));
        assert.ok(spawnError, "Expected error on spawn_locations field");
      }
    });

    void test("does not require propagation_method for Fish", () => {
      const data = { ...validFishData(), propagation_method: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("does not require lighting fields for Fish", () => {
      const data = { ...validFishData(), light_type: undefined, light_strength: undefined, light_hours: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });
  });

  void describe("Invert submissions", () => {
    void test("passes with complete valid Invert data", () => {
      const result = bapForm.safeParse(validInvertData());
      assert.strictEqual(result.success, true);
    });

    void test("requires count for Invert", () => {
      const data = { ...validInvertData(), count: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const countError = result.error.issues.find((i) => i.path.includes("count"));
        assert.ok(countError, "Expected error on count field");
      }
    });

    void test("requires foods for Invert", () => {
      const data = { ...validInvertData(), foods: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });

    void test("requires spawn_locations for Invert", () => {
      const data = { ...validInvertData(), spawn_locations: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });

    void test("does not require propagation_method for Invert", () => {
      const data = { ...validInvertData(), propagation_method: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });
  });

  void describe("Plant submissions", () => {
    void test("passes with complete valid Plant data", () => {
      const result = bapForm.safeParse(validPlantData());
      assert.strictEqual(result.success, true);
    });

    void test("requires propagation_method for Plant", () => {
      const data = { ...validPlantData(), propagation_method: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const propError = result.error.issues.find((i) => i.path.includes("propagation_method"));
        assert.ok(propError, "Expected error on propagation_method field");
      }
    });

    void test("requires light_type for Plant", () => {
      const data = { ...validPlantData(), light_type: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const lightError = result.error.issues.find((i) => i.path.includes("light_type"));
        assert.ok(lightError, "Expected error on light_type field");
      }
    });

    void test("requires light_strength for Plant", () => {
      const data = { ...validPlantData(), light_strength: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const err = result.error.issues.find((i) => i.path.includes("light_strength"));
        assert.ok(err, "Expected error on light_strength field");
      }
    });

    void test("requires light_hours for Plant", () => {
      const data = { ...validPlantData(), light_hours: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const err = result.error.issues.find((i) => i.path.includes("light_hours"));
        assert.ok(err, "Expected error on light_hours field");
      }
    });

    void test("does not require count for Plant", () => {
      const data = { ...validPlantData(), count: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("does not require spawn_locations for Plant", () => {
      const data = { ...validPlantData(), spawn_locations: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("does not require foods for Plant", () => {
      const data = { ...validPlantData(), foods: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });
  });

  void describe("Coral submissions", () => {
    void test("passes with complete valid Coral data", () => {
      const result = bapForm.safeParse(validCoralData());
      assert.strictEqual(result.success, true);
    });

    void test("requires foods for Coral", () => {
      const data = { ...validCoralData(), foods: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const err = result.error.issues.find((i) => i.path.includes("foods"));
        assert.ok(err, "Expected error on foods field");
      }
    });

    void test("requires propagation_method for Coral", () => {
      const data = { ...validCoralData(), propagation_method: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const err = result.error.issues.find((i) => i.path.includes("propagation_method"));
        assert.ok(err, "Expected error on propagation_method field");
      }
    });

    void test("requires light_type for Coral", () => {
      const data = { ...validCoralData(), light_type: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });

    void test("requires light_strength for Coral", () => {
      const data = { ...validCoralData(), light_strength: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });

    void test("requires light_hours for Coral", () => {
      const data = { ...validCoralData(), light_hours: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });

    void test("does not require count for Coral", () => {
      const data = { ...validCoralData(), count: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("does not require spawn_locations for Coral", () => {
      const data = { ...validCoralData(), spawn_locations: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });
  });

  void describe("CO2 conditional requirement", () => {
    void test("does not require co2_description when co2 is no (Plant)", () => {
      const data = { ...validPlantData(), co2: "no", co2_description: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("does not require co2_description when co2 is undefined (Plant)", () => {
      const data = { ...validPlantData(), co2: undefined, co2_description: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("requires co2_description when co2 is yes (Plant)", () => {
      const data = { ...validPlantData(), co2: "yes", co2_description: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const err = result.error.issues.find((i) => i.path.includes("co2_description"));
        assert.ok(err, "Expected error on co2_description field");
      }
    });

    void test("passes when co2 is yes and co2_description is provided (Plant)", () => {
      const data = { ...validPlantData(), co2: "yes", co2_description: "Pressurized CO2 at 30ppm" };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, true);
    });

    void test("requires co2_description when co2 is yes (Coral)", () => {
      const data = { ...validCoralData(), co2: "yes", co2_description: undefined };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const err = result.error.issues.find((i) => i.path.includes("co2_description"));
        assert.ok(err, "Expected error on co2_description field");
      }
    });

    void test("does not require co2_description for Fish even with co2 yes", () => {
      const data = { ...validFishData(), co2: "yes", co2_description: undefined };
      const result = bapForm.safeParse(data);
      // Fish is not hasSupplements, so co2_description should not be required
      assert.strictEqual(result.success, true);
    });
  });

  void describe("empty foods/spawn_locations arrays", () => {
    void test("rejects empty foods array for Fish", () => {
      const data = { ...validFishData(), foods: [] as string[] };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });

    void test("rejects empty spawn_locations array for Fish", () => {
      const data = { ...validFishData(), spawn_locations: [] as string[] };
      const result = bapForm.safeParse(data);
      assert.strictEqual(result.success, false);
    });
  });
});
