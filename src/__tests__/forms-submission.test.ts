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
  bapForm,
  bapDraftForm,
  bapFields,
  speciesTypesAndClasses,
} from "../forms/submission";

// ─── Helper function tests ────────────────────────────────────────────────────

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

  void test("returns false for unknown type", () => {
    assert.strictEqual(hasFoods("Unknown"), false);
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

// ─── getBapFormTitle ──────────────────────────────────────────────────────────

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

  void test("returns Breeder Awards Submission for unknown (default)", () => {
    assert.strictEqual(getBapFormTitle("Whatever"), "Breeder Awards Submission");
  });
});

// ─── getClassOptions ──────────────────────────────────────────────────────────

void describe("getClassOptions", () => {
  void test("returns Fish classes as value/text pairs", () => {
    const options = getClassOptions("Fish");
    assert.ok(options.length > 0);
    for (const opt of options) {
      assert.ok("value" in opt && "text" in opt);
      assert.strictEqual(opt.value, opt.text);
    }
    assert.ok(options.some((o) => o.value === "Cichlids - New World"));
  });

  void test("returns Invert classes", () => {
    const options = getClassOptions("Invert");
    assert.deepStrictEqual(
      options.map((o) => o.value),
      speciesTypesAndClasses["Invert"]
    );
  });

  void test("returns Plant classes", () => {
    const options = getClassOptions("Plant");
    assert.ok(options.some((o) => o.value === "Cryptocoryne"));
  });

  void test("returns Coral classes", () => {
    const options = getClassOptions("Coral");
    assert.deepStrictEqual(
      options.map((o) => o.value),
      ["Hard", "Soft"]
    );
  });

  void test("returns empty array for unknown species type", () => {
    const options = getClassOptions("Unknown");
    assert.deepStrictEqual(options, []);
  });
});

// ─── Base required fields (bapFields) ────────────────────────────────────────

const baseRequiredFields = {
  water_type: "Fresh" as const,
  species_type: "Fish" as const,
  reproduction_date: "2024-01-15",
  species_class: "Cichlids - New World",
  species_latin_name: "Cichlasoma citrinellum",
  species_common_name: "Red Devil Cichlid",
  tank_size: "75 gallons",
  filter_type: "Canister",
  water_change_volume: "25%",
  water_change_frequency: "Weekly",
  temperature: "78°F",
  ph: "7.0",
  substrate_type: "Gravel",
  substrate_depth: "3 inches",
  substrate_color: "Natural",
};

// ─── bapFields schema ────────────────────────────────────────────────────────

void describe("bapFields schema", () => {
  void test("accepts valid base Fish data", () => {
    const result = bapFields.safeParse(baseRequiredFields);
    assert.strictEqual(result.success, true);
  });

  void test("transforms string id to integer", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, id: "42" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.id, 42);
    }
  });

  void test("transforms string member_id to integer", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, member_id: "7" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.member_id, 7);
    }
  });

  void test("leaves id undefined when not provided", () => {
    const result = bapFields.safeParse(baseRequiredFields);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.id, undefined);
    }
  });

  void test("rejects invalid water_type", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, water_type: "Pond" });
    assert.strictEqual(result.success, false);
  });

  void test("rejects invalid species_type", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, species_type: "Reptile" });
    assert.strictEqual(result.success, false);
  });

  void test("rejects empty reproduction_date", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, reproduction_date: "" });
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("reproduction_date"));
    }
  });

  void test("rejects invalid reproduction_date", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, reproduction_date: "not-a-date" });
    assert.strictEqual(result.success, false);
  });

  void test("accepts valid video_url", () => {
    const result = bapFields.safeParse({
      ...baseRequiredFields,
      video_url: "https://youtube.com/watch?v=abc123",
    });
    assert.strictEqual(result.success, true);
  });

  void test("accepts empty string for video_url", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, video_url: "" });
    assert.strictEqual(result.success, true);
  });

  void test("rejects invalid video_url", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, video_url: "not-a-url" });
    assert.strictEqual(result.success, false);
  });

  void test("accepts empty string for notes", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, notes: "" });
    assert.strictEqual(result.success, true);
  });

  void test("rejects species_class that is too long", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, species_class: "a".repeat(101) });
    assert.strictEqual(result.success, false);
  });

  void test("rejects member_email that is not an email", () => {
    const result = bapFields.safeParse({ ...baseRequiredFields, member_email: "notanemail" });
    assert.strictEqual(result.success, false);
  });

  void test("accepts valid member_email", () => {
    const result = bapFields.safeParse({
      ...baseRequiredFields,
      member_email: "user@example.com",
    });
    assert.strictEqual(result.success, true);
  });
});

// ─── bapForm — Fish validation path ─────────────────────────────────────────

const validFishData = {
  ...baseRequiredFields,
  species_type: "Fish" as const,
  count: "50",
  foods: ["Pellet", "Frozen"],
  spawn_locations: ["Cave"],
};

void describe("bapForm Fish", () => {
  void test("accepts valid Fish submission", () => {
    const result = bapForm.safeParse(validFishData);
    assert.strictEqual(result.success, true);
  });

  void test("requires count for Fish", () => {
    const data = { ...validFishData, count: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("count"), `Expected count error, got: ${JSON.stringify(result.error.issues)}`);
    }
  });

  void test("requires foods for Fish", () => {
    const data = { ...validFishData, foods: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("foods"));
    }
  });

  void test("requires spawn_locations for Fish", () => {
    const data = { ...validFishData, spawn_locations: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("spawn_locations"));
    }
  });

  void test("rejects empty foods array for Fish", () => {
    const data = { ...validFishData, foods: [] };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("foods"));
    }
  });

  void test("rejects empty spawn_locations array for Fish", () => {
    const data = { ...validFishData, spawn_locations: [] };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("spawn_locations"));
    }
  });

  void test("does NOT require propagation_method for Fish", () => {
    const data = { ...validFishData, propagation_method: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("does NOT require lighting fields for Fish", () => {
    const data = { ...validFishData, light_type: undefined, light_strength: undefined, light_hours: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });
});

// ─── bapForm — Invert validation path ────────────────────────────────────────

const validInvertData = {
  ...baseRequiredFields,
  species_type: "Invert" as const,
  water_type: "Salt" as const,
  species_class: "Shrimp",
  species_latin_name: "Neocaridina davidi",
  species_common_name: "Cherry Shrimp",
  count: "20",
  foods: ["Live"],
  spawn_locations: ["Rock"],
};

void describe("bapForm Invert", () => {
  void test("accepts valid Invert submission", () => {
    const result = bapForm.safeParse(validInvertData);
    assert.strictEqual(result.success, true);
  });

  void test("requires count for Invert", () => {
    const data = { ...validInvertData, count: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("count"));
    }
  });

  void test("requires foods for Invert", () => {
    const data = { ...validInvertData, foods: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("foods"));
    }
  });

  void test("requires spawn_locations for Invert", () => {
    const data = { ...validInvertData, spawn_locations: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("spawn_locations"));
    }
  });
});

// ─── bapForm — Plant validation path ─────────────────────────────────────────

const validPlantData = {
  ...baseRequiredFields,
  species_type: "Plant" as const,
  species_class: "Cryptocoryne",
  species_latin_name: "Cryptocoryne wendtii",
  species_common_name: "Wendt's Water Trumpet",
  propagation_method: "Division",
  light_type: "LED",
  light_strength: "High",
  light_hours: "10",
};

void describe("bapForm Plant", () => {
  void test("accepts valid Plant submission", () => {
    const result = bapForm.safeParse(validPlantData);
    assert.strictEqual(result.success, true);
  });

  void test("does NOT require count for Plant", () => {
    const data = { ...validPlantData, count: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("does NOT require foods for Plant", () => {
    const data = { ...validPlantData, foods: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("does NOT require spawn_locations for Plant", () => {
    const data = { ...validPlantData, spawn_locations: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("requires propagation_method for Plant", () => {
    const data = { ...validPlantData, propagation_method: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("propagation_method"));
    }
  });

  void test("requires light_type for Plant", () => {
    const data = { ...validPlantData, light_type: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("light_type"));
    }
  });

  void test("requires light_strength for Plant", () => {
    const data = { ...validPlantData, light_strength: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("light_strength"));
    }
  });

  void test("requires light_hours for Plant", () => {
    const data = { ...validPlantData, light_hours: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("light_hours"));
    }
  });

  void test("does NOT require co2_description when co2 is no for Plant", () => {
    const data = { ...validPlantData, co2: "no" as const, co2_description: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("requires co2_description when co2 is yes for Plant", () => {
    const data = { ...validPlantData, co2: "yes" as const, co2_description: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("co2_description"));
    }
  });

  void test("accepts Plant with co2=yes and co2_description provided", () => {
    const data = {
      ...validPlantData,
      co2: "yes" as const,
      co2_description: "Pressurized CO2 system at 1 bubble/sec",
    };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });
});

// ─── bapForm — Coral validation path ─────────────────────────────────────────

const validCoralData = {
  ...baseRequiredFields,
  species_type: "Coral" as const,
  water_type: "Salt" as const,
  species_class: "Hard",
  species_latin_name: "Acropora millepora",
  species_common_name: "Staghorn Coral",
  foods: ["Coral Food", "Zooplankton"],
  propagation_method: "Fragmentation",
  light_type: "T5 Fluorescent",
  light_strength: "400 PAR",
  light_hours: "12",
};

void describe("bapForm Coral", () => {
  void test("accepts valid Coral submission", () => {
    const result = bapForm.safeParse(validCoralData);
    assert.strictEqual(result.success, true);
  });

  void test("requires foods for Coral", () => {
    const data = { ...validCoralData, foods: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("foods"));
    }
  });

  void test("requires propagation_method for Coral", () => {
    const data = { ...validCoralData, propagation_method: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("propagation_method"));
    }
  });

  void test("requires light_type for Coral", () => {
    const data = { ...validCoralData, light_type: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("light_type"));
    }
  });

  void test("does NOT require count for Coral", () => {
    const data = { ...validCoralData, count: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("does NOT require spawn_locations for Coral", () => {
    const data = { ...validCoralData, spawn_locations: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, true);
  });

  void test("requires co2_description when co2 is yes for Coral", () => {
    const data = { ...validCoralData, co2: "yes" as const, co2_description: undefined };
    const result = bapForm.safeParse(data);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      assert.ok(paths.includes("co2_description"));
    }
  });
});

// ─── bapDraftForm ─────────────────────────────────────────────────────────────

void describe("bapDraftForm", () => {
  void test("accepts completely empty object", () => {
    const result = bapDraftForm.safeParse({});
    assert.strictEqual(result.success, true);
  });

  void test("accepts partial data with only species_type", () => {
    const result = bapDraftForm.safeParse({ species_type: "Fish" });
    assert.strictEqual(result.success, true);
  });

  void test("accepts partial data with only water_type", () => {
    const result = bapDraftForm.safeParse({ water_type: "Salt" });
    assert.strictEqual(result.success, true);
  });

  void test("accepts all required fields for a Fish", () => {
    const result = bapDraftForm.safeParse(validFishData);
    assert.strictEqual(result.success, true);
  });

  void test("still validates enum values for species_type", () => {
    const result = bapDraftForm.safeParse({ species_type: "Reptile" });
    assert.strictEqual(result.success, false);
  });

  void test("still validates enum values for water_type", () => {
    const result = bapDraftForm.safeParse({ water_type: "Lake" });
    assert.strictEqual(result.success, false);
  });

  void test("still validates email format", () => {
    const result = bapDraftForm.safeParse({ member_email: "notanemail" });
    assert.strictEqual(result.success, false);
  });

  void test("does NOT enforce refine constraints (no count required for Fish)", () => {
    // bapDraftForm is bapFields.partial() — no refine chains
    const result = bapDraftForm.safeParse({ species_type: "Fish" });
    assert.strictEqual(result.success, true);
  });
});
