import { describe, test } from "node:test";
import assert from "node:assert";
import pug from "pug";
import path from "path";

void describe("Species CARES Checkbox Rendering", () => {
  const viewsPath = path.join(__dirname, "../views");
  const templatePath = path.join(viewsPath, "admin/speciesEdit.pug");

  const baseSpeciesData = {
    isLoggedIn: true,
    isAdmin: true,
    title: "Edit Species",
    viewer: {
      id: 1,
      display_name: "Admin User",
      is_admin: true,
    },
    species: {
      id: 1,
      group_id: 1,
      canonical_genus: "Testus",
      canonical_species_name: "speciesus",
      species_type: "Fish",
      program_class: "Test Class",
      base_points: 10,
      is_cares_species: 0,
    },
    classOptions: ["Test Class", "Another Class"],
    commonNames: [],
    scientificNames: [],
  };

  void test("CARES checkbox should be unchecked when is_cares_species is 0", () => {
    const data = {
      ...baseSpeciesData,
      species: {
        ...baseSpeciesData.species,
        is_cares_species: 0,
      },
    };

    const compiledTemplate = pug.compileFile(templatePath, {
      basedir: viewsPath,
    });

    const html = compiledTemplate(data);

    // The checkbox should NOT have the checked attribute at all when is_cares_species is 0
    // Look for the checkbox input with id="is_cares_species"
    const checkboxMatch = html.match(
      /<input[^>]*id="is_cares_species"[^>]*>/
    );
    assert.ok(checkboxMatch, "Checkbox input should be present");

    const checkboxHtml = checkboxMatch[0];

    // The checkbox should NOT have the checked attribute
    assert.ok(
      !checkboxHtml.includes('checked="'),
      "Checkbox should not have checked attribute when is_cares_species is 0"
    );
  });

  void test("CARES checkbox should be checked when is_cares_species is 1", () => {
    const data = {
      ...baseSpeciesData,
      species: {
        ...baseSpeciesData.species,
        is_cares_species: 1,
      },
    };

    const compiledTemplate = pug.compileFile(templatePath, {
      basedir: viewsPath,
    });

    const html = compiledTemplate(data);

    // The checkbox should have the checked attribute when is_cares_species is 1
    const checkboxMatch = html.match(
      /<input[^>]*id="is_cares_species"[^>]*>/
    );
    assert.ok(checkboxMatch, "Checkbox input should be present");

    const checkboxHtml = checkboxMatch[0];

    // The checkbox should have checked="checked" or similar
    assert.ok(
      checkboxHtml.includes("checked"),
      "Checkbox should have checked attribute when is_cares_species is 1"
    );
  });

  void test("CARES checkbox should handle truthy SQLite values", () => {
    // Test with various truthy values that SQLite might return
    const truthyValues = [1, true, "1"];

    for (const value of truthyValues) {
      const data = {
        ...baseSpeciesData,
        species: {
          ...baseSpeciesData.species,
          is_cares_species: value,
        },
      };

      const compiledTemplate = pug.compileFile(templatePath, {
        basedir: viewsPath,
      });

      const html = compiledTemplate(data);

      const checkboxMatch = html.match(
        /<input[^>]*id="is_cares_species"[^>]*>/
      );
      assert.ok(checkboxMatch, `Checkbox should be present for value ${value}`);

      const checkboxHtml = checkboxMatch[0];
      assert.ok(
        checkboxHtml.includes("checked"),
        `Checkbox should be checked for truthy value ${value}`
      );
    }
  });

  void test("CARES checkbox should handle falsy SQLite values", () => {
    // Test with various falsy values that SQLite might return
    const falsyValues = [0, false, null, undefined, ""];

    for (const value of falsyValues) {
      const data = {
        ...baseSpeciesData,
        species: {
          ...baseSpeciesData.species,
          is_cares_species: value,
        },
      };

      const compiledTemplate = pug.compileFile(templatePath, {
        basedir: viewsPath,
      });

      const html = compiledTemplate(data);

      const checkboxMatch = html.match(
        /<input[^>]*id="is_cares_species"[^>]*>/
      );
      assert.ok(checkboxMatch, `Checkbox should be present for value ${value}`);

      const checkboxHtml = checkboxMatch[0];
      assert.ok(
        !checkboxHtml.includes('checked="'),
        `Checkbox should not have checked attribute for falsy value ${value}`
      );
    }
  });
});
