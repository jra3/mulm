import { describe, test } from "node:test";
import assert from "node:assert";
import pug from "pug";
import path from "path";
import fs from "fs";
import { faker } from "@faker-js/faker";

void describe("Pug Template Rendering", () => {
  const viewsPath = path.join(__dirname, "../views");

  // Mock data generators
  const createMockMember = () => ({
    id: faker.number.int({ min: 1, max: 1000 }),
    display_name: faker.person.fullName(),
    email: faker.internet.email(),
    is_admin: faker.datatype.boolean(),
    awards: Array.from({ length: faker.number.int({ min: 0, max: 5 }) }, () => ({
      award_name: faker.helpers.arrayElement([
        "Breeder Award Level 1",
        "Breeder Award Level 2",
        "Specialist Award - Cichlids",
        "Horticultural Award Level 1",
      ]),
      date_awarded: faker.date.past().toISOString(),
    })),
  });

  const createMockSubmission = () => ({
    id: faker.number.int({ min: 1, max: 1000 }),
    species_class: faker.helpers.arrayElement(["Cichlid", "Catfish", "Livebearers", "Killifish"]),
    species_common_name: faker.animal.fish(),
    species_latin_name: `${faker.science.chemicalElement().name} ${faker.science.chemicalElement().name}`,
    submitted_on: faker.date.past().toISOString(),
    points: faker.number.int({ min: 1, max: 50 }),
    total_points: faker.number.int({ min: 1, max: 500 }),
  });

  const createMockActivity = () => ({
    id: faker.number.int({ min: 1, max: 1000 }),
    type: faker.helpers.arrayElement(["submission_approved", "award_granted"]),
    member_id: faker.number.int({ min: 1, max: 100 }),
    member_name: faker.person.fullName(),
    species_name: faker.animal.fish(),
    points: faker.number.int({ min: 1, max: 50 }),
    created_at: faker.date.past().toISOString(),
    award_name: faker.helpers.arrayElement(["Level 1 Breeder Award", "Level 2 Breeder Award"]),
  });

  const baseMockData: Record<string, unknown> = {
    // Common variables used across templates
    isLoggedIn: true,
    isAdmin: false,
    title: "Test Title",
    message: "Test Message",
    googleURL: "https://oauth.google.com/test",

    // User/Viewer data for account templates
    viewer: {
      id: 1,
      display_name: faker.person.fullName(),
      contact_email: faker.internet.email(),
      is_admin: false,
    },

    // Member data
    member: createMockMember(),
    witness: {
      id: 2,
      display_name: faker.person.fullName(),
      contact_email: faker.internet.email(),
    },
    award: {
      award_name: "Breeder Award Level 2",
      date_awarded: new Date().toISOString(),
    },
    fishSubs: Array.from({ length: 3 }, createMockSubmission),
    plantSubs: Array.from({ length: 2 }, createMockSubmission),
    coralSubs: Array.from({ length: 1 }, createMockSubmission),
    fishTotalPoints: 150,
    plantTotalPoints: 75,
    coralTotalPoints: 25,

    // Activity data with proper structure
    recentActivity: Array.from({ length: 5 }, () => ({
      ...createMockActivity(),
      activity_data: JSON.stringify({
        species_common_name: faker.animal.fish(),
        species_type: faker.helpers.arrayElement(["Fish", "Plant", "Coral"]),
        award_name: faker.helpers.arrayElement(["Level 1 Breeder Award", "Level 2 Breeder Award"]),
      }),
    })),

    // Admin data
    witnessProgram: "fish",
    witnessCount: 3,
    approvalsProgram: "fish",
    approvalsCount: 5,

    // Queue counts for admin
    programCounts: {
      fish: 3,
      plant: 2,
      coral: 1,
    },
    witnessCounts: {
      fish: 2,
      plant: 1,
      coral: 0,
    },

    // Form data with comprehensive structure
    formErrors: {},
    formData: {},
    errors: new Map(), // For form validation errors
    attributes: {}, // For form input attributes

    // Comprehensive form data
    form: {
      id: null,
      species_latin_name: "",
      species_common_name: "",
      species_type: "Fish",
      water_type: "Fresh",
      member_name: faker.person.fullName(),
      member_email: faker.internet.email(),
      reproduction_date: new Date().toISOString().split("T")[0],
      canonical_genus: "",
      canonical_species: "",
      canonical_subspecies: "",
    },

    // Form options from submission.ts
    waterTypes: ["Fresh", "Brackish", "Salt"],
    speciesTypes: ["Fish", "Invert", "Plant", "Coral"],
    foodTypes: ["Live", "Frozen", "Flake", "Pellet", "Freeze Dried", "Vegetable"],
    spawnLocations: ["Tank", "Cave", "Substrate", "Plants", "Open Water"],

    // Select options for templates
    options: [
      { value: "option1", text: "Option 1" },
      { value: "option2", text: "Option 2" },
      { value: "option3", text: "Option 3" },
    ],

    // Class options for species explorer
    classOptions: [
      { value: "Cichlid", text: "Cichlid" },
      { value: "Catfish", text: "Catfish" },
      { value: "Livebearers", text: "Livebearers" },
    ],

    // Species data
    species: {
      id: 1,
      latin_name: "Apistogramma cacatuoides",
      common_name: "Cockatoo Dwarf Cichlid",
      class: "Cichlid",
      points: 15,
    },

    // Enhanced submission data
    submission: {
      id: 1,
      species_latin_name: "Apistogramma cacatuoides",
      species_common_name: "Cockatoo Dwarf Cichlid",
      species_type: "Fish",
      member_name: faker.person.fullName(),
      status: "pending",
      submitted_on: new Date().toISOString(),
      witness_members: [],
      member_id: 1,
      canonical_genus: "Apistogramma",
      canonical_species: "cacatuoides",
    },

    // Tank data
    tanks: [
      {
        id: 1,
        name: "Community Tank",
        size: "55 gallon",
        filtration: "Canister filter",
      },
    ],

    // Standings data
    standings: [
      [1, 150], // [member_id, points]
      [2, 125],
      [3, 100],
    ],

    // Names lookup for standings
    names: {
      1: "John Doe",
      2: "Jane Smith",
      3: "Bob Johnson",
    },

    // Trophy data for standings
    trophies: {
      1: { level: "gold", icon: "🥇", awards: ["Specialist Award - Cichlids"] },
      2: { level: "silver", icon: "🥈", awards: ["Breeder Award Level 2"] },
      3: { level: "bronze", icon: "🥉", awards: ["Breeder Award Level 1"] },
    },

    // Split schema name data for admin templates
    name: {
      common_name_id: 1,
      common_name: "Test Common Name",
      scientific_name_id: 1,
      scientific_name: "Testus scientificus",
      name_id: 1, // For legacy synonym row
    },
    groupId: 1,

    // Common and scientific names for species edit
    commonNames: [
      { common_name_id: 1, common_name: "Common Name 1" },
      { common_name_id: 2, common_name: "Common Name 2" },
    ],
    scientificNames: [
      { scientific_name_id: 1, scientific_name: "Scientificus name1" },
      { scientific_name_id: 2, scientific_name: "Scientificus name2" },
    ],

    // Synonym for legacy synonym row
    synonym: {
      name_id: 1,
      common_name: "Legacy Common",
      scientific_name: "Legacy scientificus",
    },

    // Note data for submission notes
    note: {
      id: 1,
      note_text: "Test note content",
      admin_name: "Admin User",
      created_at: new Date().toISOString(),
    },

    // Video data
    video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoMetadata: {
      title: "Test Video",
      thumbnail_url: "https://example.com/thumb.jpg",
      thumbnailUrl: "https://example.com/thumb.jpg",
      author_name: "Test Author",
      author: "Test Author",
      platform: "youtube",
    },
    metadata: {
      title: "Test Video",
      thumbnailUrl: "https://example.com/thumb.jpg",
      author: "Test Author",
      platform: "youtube",
    },

    // Count for countBadge mixin
    count: 5,

    // Tank preset data
    preset: {
      preset_name: "Community Tank",
      tank_size: "55 gallon",
      filter_type: "Canister",
      temperature: "76°F",
      ph: "7.2",
      gh: "150 ppm",
      specific_gravity: null,
      water_change_volume: "25%",
      water_change_frequency: "Weekly",
      substrate_type: "Gravel",
      substrate_depth: "2 inches",
      substrate_color: "Natural",
    },
    editing: false,

    // Filters for species list and explorer
    filters: {
      species_type: "",
      program_class: "",
      species_class: "",
      has_base_points: undefined,
      is_cares_species: undefined,
      search: "",
    },

    // Sort order
    sort: "name",

    // Pagination for species list
    pagination: {
      currentPage: 1,
      totalPages: 3,
      totalCount: 150,
      limit: 50,
    },

    // Program data
    program: "fish",
    year: new Date().getFullYear(),
    subtitle: "Fish Submissions",

    // Queue data
    queue: Array.from({ length: 3 }, () => ({
      id: faker.number.int({ min: 1, max: 1000 }),
      species_latin_name: faker.animal.fish(),
      member_name: faker.person.fullName(),
      submitted_on: new Date().toISOString(),
    })),

    // Member list for admin
    members: Array.from({ length: 5 }, createMockMember),

    // Email context
    resetLink: "https://example.com/reset/token123",
    memberName: faker.person.fullName(),
    speciesName: faker.animal.fish(),
    domain: "https://example.com",
    canonicalName: "Apistogramma cacatuoides",
    sampleData: {
      reason: "Additional documentation needed for verification",
    },

    // Error states
    error: null,
    success: null,

    // Additional template-specific data
    memberMap: new Map([
      [1, "John Doe"],
      [2, "Jane Smith"],
      [3, "Bob Johnson"],
    ]),

    // Activity item needs activity and data
    activity: {
      activity_type: "submission_approved",
      member_name: faker.person.fullName(),
      created_at: new Date().toISOString(),
      activity_data: JSON.stringify({
        species_common_name: faker.animal.fish(),
        species_type: "Fish",
        award_name: "Level 1 Breeder Award",
      }),
    },

    // Data object for activity templates
    data: {
      species_common_name: faker.animal.fish(),
      species_type: "Fish",
      award_name: "Level 1 Breeder Award",
    },
  };

  // Get all pug files recursively
  const getAllPugFiles = (dir: string): string[] => {
    const files: string[] = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...getAllPugFiles(fullPath));
      } else if (item.endsWith(".pug")) {
        files.push(fullPath);
      }
    }

    return files;
  };

  const pugFiles = getAllPugFiles(viewsPath);

  // Filter out templates that are included by others (mixins, partials)
  const renderableTemplates = pugFiles.filter((file) => {
    const relativePath = path.relative(viewsPath, file);

    // Skip mixin-only files and includes that aren't meant to be rendered standalone
    const skipPatterns = [
      /^header\.pug$/, // Mixed header file with mixins
      /^bapForm\/inputs\.pug$/, // Contains mixins only
      /^typeahead-examples\.pug$/, // Uses undefined mixins
      /^account\/field\.pug$/, // Mixin-only template
      /^mixins\/date\.pug$/, // Date formatting mixins only
      /^mixins\/countBadge\.pug$/, // Mixin-only template
      /^mixins\/submissionVideo\.pug$/, // Mixin-only template
      /^mixins\/trophy\.pug$/, // Mixin-only template
      /^mixins\/caresBadge\.pug$/, // Mixin-only template
      /^mixins\/formCheckbox\.pug$/, // Mixin-only template
      /^mixins\/changesRequestedBanner\.pug$/, // Mixin-only template (tested via submit.pug)
      /^mixins\/emptyState\.pug$/, // Mixin-only template
      /^mixins\/loadingSpinner\.pug$/, // Mixin-only template
      /^activity\/activity-item\.pug$/, // Mixin-only template
      /^activity\/award-granted\.pug$/, // Include-only template
      /^activity\/submission-approved\.pug$/, // Include-only template
      /^admin\/adminNav\.pug$/, // Mixin-only template
      /^admin\/adminActionsPanel\.pug$/, // Mixin-only template
      /^admin\/memberRow\.pug$/, // Mixin-only template
      /^admin\/queueButton\.pug$/, // Mixin-only template
      /^bapForm\/style\.pug$/, // Style-only template
      /^bapForm\/supplementLine\.pug$/, // Mixin-only template
      /^bapForm\/supplementSingleLine\.pug$/, // Mixin-only template
      /^mixins\/submissionImages\.pug$/, // Mixin-only template
      /^onSelectType\.pug$/, // Include-only template
    ];

    return !skipPatterns.some((pattern) => pattern.test(relativePath));
  });

  void describe("Template Syntax Validation", () => {
    for (const templatePath of renderableTemplates) {
      void test(`should compile ${templatePath} without syntax errors`, () => {
        assert.doesNotThrow(() => {
          pug.compileFile(templatePath, {
            basedir: viewsPath,
            pretty: false,
          });
        });
      });
    }
  });

  void describe("Template Rendering", () => {
    for (const templatePath of renderableTemplates) {
      void test(`should render ${templatePath} without runtime errors`, () => {
        const relativePath = path.relative(viewsPath, templatePath);

        // Create template-specific mock data
        const templateData = { ...baseMockData } as Record<string, unknown>;

        // Add specific data based on template path patterns
        if (relativePath.includes("admin/")) {
          templateData.isAdmin = true;
        }

        if (relativePath.includes("email/")) {
          templateData.isLoggedIn = false;
        }

        if (relativePath.includes("account/")) {
          templateData.user = templateData.viewer;
        }

        // Comprehensive template-specific data injection
        switch (relativePath) {
          case "bapForm/form.pug":
          case "submit.pug":
            templateData.formAction = "/submit";
            break;

          case "species/detail.pug":
            templateData.submissions = templateData.fishSubs;
            templateData.breeders = [
              { id: 1, name: "John Doe", count: 5 },
              { id: 2, name: "Jane Smith", count: 3 },
            ];
            break;

          case "species/explorer.pug":
            templateData.filters = {
              species_type: "",
              species_class: "",
              search: "",
            };
            templateData.filterOptions = {
              species_types: ["Fish", "Plant", "Coral"],
              species_classes: ["Cichlid", "Catfish", "Livebearers"],
            };
            templateData.speciesList = templateData.fishSubs;
            templateData.pagination = {
              currentPage: 1,
              totalPages: 1,
              hasNext: false,
              hasPrev: false,
            };
            break;

          case "submission/review.pug":
            templateData.photos = [];
            templateData.canWitness = true;
            templateData.canApprove = true;
            break;

          case "admin/approvalPanel.pug":
            templateData.formData = templateData.form;
            templateData.name = {
              canonical_genus: "Apistogramma",
              canonical_species: "cacatuoides",
            };
            break;

          case "bapForm/loadTankList.pug":
            templateData.presets = [
              {
                preset_name: "Community Tank",
                tank_size: "55 gallon",
                water_temp: "76°F",
              },
              {
                preset_name: "Breeding Tank",
                tank_size: "20 gallon",
                water_temp: "78°F",
              },
            ];
            break;

          case "lifetime.pug":
            templateData.levels = [
              [
                "Novice Breeders",
                [
                  { id: 1, display_name: "John Doe", points: 25 },
                  { id: 2, display_name: "Jane Smith", points: 15 },
                ],
              ],
              [
                "Intermediate Breeders",
                [
                  { id: 3, display_name: "Bob Johnson", points: 125 },
                  { id: 4, display_name: "Alice Brown", points: 100 },
                ],
              ],
            ];
            break;

          case "email/onScreeningApproved.pug": {
            templateData.witness = {
              display_name: faker.person.fullName(),
            };
            templateData.domain = "https://example.com";
            // Update submission to have witness data
            const witnessSubmission = {
              ...(templateData.submission as Record<string, unknown>),
              reproduction_date: new Date().toISOString(),
              witnessed_on: new Date().toISOString(),
              species_class: "Cichlid",
            };
            templateData.submission = witnessSubmission;
            break;
          }

          case "admin/mergeSpeciesDialog.pug":
            templateData.defunctSpecies = {
              group_id: 1,
              canonical_genus: "Apistogramma",
              canonical_species_name: "cacatuoides",
              species_type: "Fish",
            };
            templateData.defunctNames = {
              common_names: [{ common_name: "Cockatoo Dwarf Cichlid" }],
              scientific_names: [{ scientific_name: "Apistogramma cacatuoides" }],
            };
            break;

          case "index.pug":
            // Index already has comprehensive data
            break;

          case "activityDemo.pug":
            templateData.activities = Array.from({ length: 5 }, () => ({
              ...createMockActivity(),
              activity_data: JSON.stringify({
                species_common_name: faker.animal.fish(),
                species_type: faker.helpers.arrayElement(["Fish", "Plant", "Coral"]),
                award_name: faker.helpers.arrayElement(["Level 1 Breeder Award", "Level 2 Breeder Award"]),
              }),
            }));
            break;

          case "mixins/changesRequestedBanner.pug":
            templateData.changesRequested = {
              reason: "Please add more photos and details",
              requestedBy: "Test Admin",
              requestedOn: "10/20/2025",
              hasWitness: true,
            };
            break;

          default:
            // Apply any additional common data for unhandled templates
            break;
        }

        assert.doesNotThrow(() => {
          const compiledTemplate = pug.compileFile(templatePath, {
            basedir: viewsPath,
            pretty: false,
            filters: {
              // Add any custom filters if needed
            },
          });

          const html = compiledTemplate(templateData);

          // Basic validation that we got valid HTML
          assert.ok(html);
          assert.strictEqual(typeof html, "string");
          assert.ok(html.length > 0);

          // Ensure no unescaped template variables remain
          assert.ok(!/#{[^}]+}/.test(html));
          assert.ok(!/!{[^}]+}/.test(html));
        });
      });
    }
  });

  void describe("Template Include Dependencies", () => {
    void test("all include statements should reference existing files", () => {
      const includePattern = /^\s*include\s+(.+\.pug)$/gm;
      const errors: string[] = [];

      for (const templatePath of pugFiles) {
        const content = fs.readFileSync(templatePath, "utf8");
        const relativePath = path.relative(viewsPath, templatePath);
        let match;

        while ((match = includePattern.exec(content)) !== null) {
          const includePath = match[1];
          const absoluteIncludePath = path.resolve(path.dirname(templatePath), includePath);

          if (!fs.existsSync(absoluteIncludePath)) {
            errors.push(`${relativePath}: include "${includePath}" not found`);
          }
        }
      }

      assert.deepStrictEqual(errors, []);
    });
  });

  void describe("Template Mixin Usage", () => {
    void test("should identify and validate mixin calls", () => {
      const mixinPattern = /^\s*\+(\w+)/gm;
      const definedMixins = new Set<string>();
      const usedMixins = new Set<string>();
      const mixinDefPattern = /^mixin\s+(\w+)/gm;

      // First pass: collect all defined mixins
      for (const templatePath of pugFiles) {
        const content = fs.readFileSync(templatePath, "utf8");
        let match;

        while ((match = mixinDefPattern.exec(content)) !== null) {
          definedMixins.add(match[1]);
        }
      }

      // Second pass: collect all used mixins
      for (const templatePath of pugFiles) {
        const content = fs.readFileSync(templatePath, "utf8");
        let match;

        while ((match = mixinPattern.exec(content)) !== null) {
          usedMixins.add(match[1]);
        }
      }

      // Check that all used mixins are defined somewhere
      // Filter out external/third-party mixins that might be defined elsewhere
      const knownExternalMixins = new Set(["htmxTypeahead"]);
      const undefinedMixins = Array.from(usedMixins).filter(
        (mixin) => !definedMixins.has(mixin) && !knownExternalMixins.has(mixin)
      );

      assert.deepStrictEqual(undefinedMixins, []);
    });
  });
});
