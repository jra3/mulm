import { describe, test } from "node:test";
import assert from "node:assert";
import pug from "pug";
import path from "path";
import fs from "fs";
import { faker } from "@faker-js/faker";
import { getNextLevel, programMetadata } from "../programs";
import { bonusBreakdown, bonusFields } from "../points";

void describe("Pug Template Rendering", () => {
  const viewsPath = path.join(__dirname, "../views");

  // Mock data generators
  const createMockMember = () => ({
    id: faker.number.int({ min: 1, max: 1000 }),
    display_name: faker.person.fullName(),
    email: faker.internet.email(),
    contact_email: faker.internet.email(),
    is_admin: faker.datatype.boolean(),
    fish_level: "Hobbyist",
    fishTotalPoints: 75,
    plant_level: "Beginner Aquatic Horticulturist",
    plantTotalPoints: 30,
    coral_level: "Participant",
    coralTotalPoints: 10,
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
      group_id: 1,
      latin_name: "Apistogramma cacatuoides",
      common_name: "Cockatoo Dwarf Cichlid",
      canonical_genus: "Apistogramma",
      canonical_species_name: "cacatuoides",
      class: "Cichlid",
      program_class: "Cichlids",
      species_type: "Fish",
      points: 15,
      base_points: 15,
      is_cares_species: 0,
      iucn_redlist_category: "LC",
      iucn_population_trend: "Stable",
      iucn_last_updated: new Date().toISOString(),
      iucn_redlist_id: 12345,
      name_count: 2,
      names: { common: [], scientific: [] },
      external_references: null,
      image_links: null,
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

    // Itemised bonuses for the approval email; the CARES suite at the bottom of
    // this file renders that template with a real breakdown
    bonusLines: [],

    // The bonus fields the approval panel's error mixin loops over
    bonusFields,

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

    // One Name, as the catalogue returns it, for the admin Name rows
    name: { name_id: 1, species_id: 1, kind: "common", name: "Test Common Name" },
    groupId: 1,

    // A Species' Names by kind, for species edit, detail and the hovercard
    commonNames: [
      { name_id: 1, species_id: 1, kind: "common", name: "Common Name 1" },
      { name_id: 2, species_id: 1, kind: "common", name: "Common Name 2" },
    ],
    scientificNames: [
      { name_id: 1, species_id: 1, kind: "scientific", name: "Scientificus name1" },
      { name_id: 2, species_id: 1, kind: "scientific", name: "Scientificus name2" },
    ],

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

    // Collection data
    entry: {
      id: faker.number.int({ min: 1, max: 1000 }),
      member_id: 1,
      group_id: 1,
      common_name: faker.animal.fish(),
      scientific_name: `${faker.science.chemicalElement().name} ${faker.science.chemicalElement().name}`,
      acquired_date: faker.date.past().toISOString().split("T")[0],
      removed_date: null,
      notes: faker.lorem.sentence(),
      images: null,
      visibility: "public",
      species: {
        program_class: "Cichlids",
        species_type: "Fish",
        is_cares_species: false,
      },
    },
    collection: Array.from({ length: 3 }, () => ({
      id: faker.number.int({ min: 1, max: 1000 }),
      member_id: 1,
      group_id: faker.number.int({ min: 1, max: 100 }),
      common_name: faker.animal.fish(),
      scientific_name: `${faker.science.chemicalElement().name} ${faker.science.chemicalElement().name}`,
      acquired_date: faker.date.past().toISOString().split("T")[0],
      removed_date: null,
      notes: faker.lorem.sentence(),
      images: null,
      visibility: "public",
      species: {
        program_class: faker.helpers.arrayElement(["Cichlids", "Catfish", "Livebearers"]),
        species_type: "Fish",
        is_cares_species: faker.datatype.boolean(),
      },
    })),
    collectionStats: {
      current: 3,
      lifetime: 5,
    },
    isSelf: true,
    keeperCount: faker.number.int({ min: 1, max: 20 }),
    keepers: Array.from({ length: 3 }, () => ({
      id: faker.number.int({ min: 1, max: 100 }),
      display_name: faker.person.fullName(),
    })),

    // Helper functions for templates
    getNextLevel,
    programMetadata,
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
      /^mixins\/iucnBadge\.pug$/, // Mixin-only template
      /^mixins\/formCheckbox\.pug$/, // Mixin-only template
      /^mixins\/changesRequestedBanner\.pug$/, // Mixin-only template (tested via submit.pug)
      /^mixins\/emptyState\.pug$/, // Mixin-only template
      /^mixins\/loadingSpinner\.pug$/, // Mixin-only template
      /^mixins\/card\.pug$/, // Mixin-only template
      /^mixins\/errorAlert\.pug$/, // Mixin-only template
      /^mixins\/progressBar\.pug$/, // Mixin-only template
      /^mixins\/hoverCard\.pug$/, // Mixin-only template
      /^mixins\/memberPointsHover\.pug$/, // Mixin-only template
      /^mixins\/errorMessage\.pug$/, // Mixin-only template
      /^mixins\/collectionCard\.pug$/, // Mixin-only template
      /^activity\/activity-item\.pug$/, // Mixin-only template
      /^activity\/activity-list-partial\.pug$/, // Partial template for HTMX pagination
      /^activity\/award-granted\.pug$/, // Include-only template
      /^activity\/level-up\.pug$/, // Include-only template
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
      /^member\/caresSection\.pug$/, // Mixin-only template (included by member.pug)
      /^admin\/externalDataStatus\.pug$/, // Partial included by externalData.pug + served via HTMX
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

          case "admin/externalData.pug":
            templateData.state = {
              running: false,
              startedAt: null,
              finishedAt: null,
              lastSummary: { processed: 0, linksAdded: 0, imagesAdded: 0, notFound: 0, errors: 0 },
              lastError: null,
            };
            templateData.stats = {
              total_species: 0,
              species_with_external_links: 0,
              species_with_images: 0,
              successful_syncs: 0,
            };
            templateData.recentLog = [];
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
            templateData.state = "inApprovalQueue";
            templateData.changesRequested = false;
            // The moves the transition table would allow this viewer; the page
            // shows a button only where this says yes.
            templateData.allowed = {
              saveDraft: false,
              submit: false,
              saveChanges: true,
              returnToDraft: false,
              confirmWitness: false,
              enterApprovalQueue: false,
              removeFromQueue: true,
              requestChanges: true,
              resubmit: false,
              approve: true,
              correctPoints: false,
              deleteSubmission: true,
            };
            templateData.waitingPeriodStatus = {
              requiredDays: 60,
              elapsedDays: 70,
              daysRemaining: 0,
              elapsed: true,
            };
            break;

          case "email/onSpecialtyAward.pug":
            templateData.awardName = "Anabantoid Specialist Award";
            break;

          case "email/committeeDigest.pug":
          case "demo/emails.pug":
            templateData.awardName = "Anabantoid Specialist Award";
            templateData.reason = "Please add a photo of the fry.";
            templateData.program = "fish";
            templateData.newLevel = "Breeder";
            templateData.totalPoints = 75;
            templateData.digest = {
              total: 1,
              sections: [
                {
                  program: "fish",
                  programName: "Breeder Awards Program",
                  queue: "witness",
                  title: "Waiting to be screened",
                  submissions: [
                    {
                      id: 1,
                      memberName: "Jane Aquarist",
                      speciesCommonName: "Endler Guppy",
                      speciesLatinName: "Poecilia wingei",
                      waitingSince: new Date().toISOString(),
                    },
                  ],
                },
              ],
            };
            break;

          case "admin/approvalPanel.pug":
            templateData.formData = templateData.form;
            templateData.name = {
              canonical_genus: "Apistogramma",
              canonical_species: "cacatuoides",
            };
            break;

          case "admin/witnessErrors.pug":
            templateData.messages = ["Choose a Species from the catalogue"];
            break;

          case "admin/witnessPanel.pug":
            templateData.boundSpecies = null;
            templateData.allowed = { confirmWitness: false, bindSpecies: true, requestChanges: true };
            break;

          case "admin/editApprovedErrors.pug":
            templateData.messages = [
              "The flowered bonus does not apply to Breeders Awards Program submissions",
            ];
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
              common: [{ name_id: 1, species_id: 1, kind: "common", name: "Cockatoo Dwarf Cichlid" }],
              scientific: [
                { name_id: 2, species_id: 1, kind: "scientific", name: "Apistogramma cacatuoides" },
              ],
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
            };
            break;

          case "account/specialtyAwards.pug":
            templateData.specialtyProgress = [
              {
                name: "Cichlid Specialist",
                isCompleted: true,
                currentSpecies: 10,
                requiredSpecies: 10,
                speciesList: ["Pelvicachromis pulcher", "Apistogramma cacatuoides", "Microgeophagus ramirezi"],
              },
              {
                name: "Catfish Specialist",
                isCompleted: false,
                currentSpecies: 5,
                requiredSpecies: 10,
                speciesList: ["Corydoras paleatus", "Ancistrus sp."],
              },
            ];
            break;

          case "admin/createSpeciesDialog.pug":
            templateData.prefilled = {
              canonical_genus: "Puntius",
              canonical_species_name: "conchonius",
            };
            break;

          case "cares.pug":
            templateData.stats = { speciesCount: 42, memberCount: 12 };
            templateData.isParticipant = false;
            templateData.memberSpeciesCount = 0;
            break;

          case "dialog/cares-fry-share.pug":
            templateData.registrations = [
              { group_id: 1, common_name: "Cockatoo Dwarf Cichlid", scientific_name: "Apistogramma cacatuoides" },
            ];
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

  /**
   * ADR-0001: any member save voids a confirmed Witness, so the edit form
   * warns before the member saves - and only when there is a Witness to lose.
   */
  void describe("Edit form Witness warning", () => {
    const renderSubmit = pug.compileFile(path.join(viewsPath, "submit.pug"), {
      basedir: viewsPath,
      pretty: false,
    });

    const submitted = {
      ...baseMockData.form,
      id: 7,
      member_id: 1,
      submitted_on: new Date().toISOString(),
    };

    function render(data: Record<string, unknown>) {
      return renderSubmit({ ...baseMockData, formAction: "/submit", ...data });
    }

    void test("a witnessed Submission's edit form warns that saving voids the Witness", () => {
      const html = render({ form: submitted, witnessConfirmed: true });

      assert.match(html, /witnessed again/);
    });

    void test("an unwitnessed Submission's edit form does not warn", () => {
      const html = render({ form: submitted, witnessConfirmed: false });

      assert.doesNotMatch(html, /witnessed again/);
    });

    void test("a request for changes no longer promises the Witness is kept", () => {
      const html = render({
        form: { ...submitted, changes_requested_on: new Date().toISOString() },
        witnessConfirmed: true,
        changesRequested: {
          reason: "Please add a photo of the fry",
          requestedBy: "Test Admin",
          requestedOn: "10/20/2025",
        },
      });

      assert.match(html, /witnessed again/);
      assert.doesNotMatch(html, /preserved/);
    });
  });

  /**
   * The species views read Names in the catalogue's shape - `name_id` and
   * `name`, by kind - and a refused delete has somewhere to say "merge".
   */
  /**
   * The witness panel binds: bound, it names the Species and offers a rebind;
   * unbound, it offers the catalogue typeahead and the create-Species dialog,
   * and no confirmation until it is bound.
   */
  void describe("Witness panel", () => {
    const render = (data: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, "admin/witnessPanel.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: true,
        submission: { id: 42, species_type: "Fish" },
        allowed: { confirmWitness: true, bindSpecies: true, requestChanges: true },
        ...data,
      });
    const bound = {
      group_id: 7,
      canonical_genus: "Poecilia",
      canonical_species_name: "reticulata",
      species_type: "Fish",
      program_class: "Livebearers",
    };

    void test("bound: shows the Canonical name, a rebind, and the confirmation", () => {
      const html = render({ boundSpecies: bound, boundSpeciesName: "Poecilia reticulata" });

      assert.match(html, /id="witness-bound-species"[^>]*>Poecilia reticulata</);
      assert.match(html, /Livebearers/);
      assert.match(html, /Change Species/);
      assert.match(html, /hx-post="\/admin\/submissions\/42\/bind-species"/);
      assert.match(html, />Rebind</);
      assert.match(html, /hx-post="\/admin\/submissions\/42\/confirm-witness"/);
      assert.match(html, /Approve for Screening/);
      assert.doesNotMatch(html, /Not bound to a Species/);
    });

    void test("unbound: offers the catalogue typeahead and create-Species dialog, and no confirmation", () => {
      // The table refuses the Witness while unbound, so the move is not allowed
      const html = render({
        boundSpecies: null,
        allowed: { confirmWitness: false, bindSpecies: true, requestChanges: true },
      });

      assert.match(html, /Not bound to a Species yet/);
      assert.match(html, /<select[^>]*name="group_id"[^>]*data-api-url="\/api\/species\/search"/);
      assert.match(html, /hx-post="\/admin\/submissions\/42\/bind-species"/);
      assert.match(html, />Bind</);
      assert.match(html, /hx-get="\/admin\/dialog\/species\/new\?submission_id=42"/);
      assert.doesNotMatch(html, /Approve for Screening/);
      assert.doesNotMatch(html, /confirm-witness/);
      assert.match(html, /Bind a Species to approve for screening/);
    });

    void test("without the bind move, no bind controls are offered", () => {
      const html = render({
        boundSpecies: bound,
        boundSpeciesName: "Poecilia reticulata",
        allowed: { confirmWitness: true },
      });
      assert.doesNotMatch(html, /bind-species/);
      assert.doesNotMatch(html, /dialog\/species\/new/);
    });

    void test("the create-Species dialog creates and binds in one request", () => {
      const html = pug.compileFile(path.join(viewsPath, "admin/createSpeciesDialog.pug"), {
        basedir: viewsPath,
        pretty: false,
      })({
        ...baseMockData,
        submission: { id: 42, species_type: "Fish", species_latin_name: "Newgenus novus" },
        prefilled: { canonical_genus: "Newgenus", canonical_species_name: "novus", program_class: "" },
        classOptions: [{ value: "Livebearers", text: "Livebearers" }],
        errors: new Map([["_general", "The Species was created, but not bound"]]),
      });
      assert.match(html, /hx-post="\/admin\/submissions\/42\/species"/);
      assert.match(html, /Create Species and Bind/);
      assert.match(html, /value="Newgenus"/);
      assert.match(html, /The Species was created, but not bound/);
    });

    void test("the approval panel no longer creates Species", () => {
      const html = pug.compileFile(path.join(viewsPath, "admin/approvalPanel.pug"), {
        basedir: viewsPath,
        pretty: false,
      })({
        ...baseMockData,
        submission: { id: 42, species_type: "Fish", program: "fish" },
        errors: new Map(),
        bonusFields: [],
      });
      assert.doesNotMatch(html, /dialog\/species\/new/);
      assert.match(html, /name="group_id"/);
    });
  });

  void describe("Species views read the catalogue's Names", () => {
    const render = (template: string, data: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, template), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: true,
        ...data,
      });

    const common = [{ name_id: 11, species_id: 3, kind: "common", name: "Kribensis" }];
    const scientific = [
      { name_id: 22, species_id: 3, kind: "scientific", name: "Pelvicachromis pulcher" },
    ];
    const species = {
      group_id: 3,
      canonical_genus: "Pelvicachromis",
      canonical_species_name: "pulcher",
      species_type: "Fish",
      program_class: "Cichlids - Old World",
      base_points: 10,
      is_cares_species: 0,
    };

    void test("the edit page lists each Name with a delete addressed by its id", () => {
      const html = render("admin/speciesEdit.pug", {
        species,
        commonNames: common,
        scientificNames: scientific,
        classOptions: [],
        speciesTypes: ["Fish"],
        errors: new Map(),
      });

      assert.match(html, /Kribensis/);
      assert.match(html, /Pelvicachromis pulcher/);
      assert.match(html, /\/admin\/species\/3\/common-names\/11/);
      assert.match(html, /\/admin\/species\/3\/scientific-names\/22/);
    });

    void test("the edit page offers no delete for the Canonical name", () => {
      const html = render("admin/speciesEdit.pug", {
        species,
        commonNames: common,
        scientificNames: [
          { ...scientific[0], canonical: true },
          { name_id: 23, species_id: 3, kind: "scientific", name: "Pelmatochromis pulcher", canonical: false },
        ],
        classOptions: [],
        speciesTypes: ["Fish"],
        errors: new Map(),
      });

      assert.doesNotMatch(html, /\/admin\/species\/3\/scientific-names\/22/);
      assert.match(html, /\/admin\/species\/3\/scientific-names\/23/);
      assert.match(html, />Canonical</);
    });

    void test("the edit page's save and delete each have a place for a refusal, and no force option", () => {
      const html = render("admin/speciesEdit.pug", {
        species,
        commonNames: common,
        scientificNames: scientific,
        classOptions: [],
        speciesTypes: ["Fish"],
        errors: new Map(),
      });

      assert.match(html, /hx-target="#species-delete-refusal"/);
      assert.match(html, /hx-target="#species-edit-refusal"/);
      assert.match(html, /id="species-edit-refusal"/);
      assert.match(html, /all its Names/);
      assert.match(html, /id="species-delete-refusal"/);
      assert.doesNotMatch(html, /force/);
    });

    void test("a new Name row renders the Name and its delete", () => {
      const commonRow = render("admin/commonNameRow.pug", { name: common[0], groupId: 3 });
      assert.match(commonRow, /Kribensis/);
      assert.match(commonRow, /\/admin\/species\/3\/common-names\/11/);

      const scientificRow = render("admin/scientificNameRow.pug", { name: scientific[0], groupId: 3 });
      assert.match(scientificRow, /Pelvicachromis pulcher/);
      assert.match(scientificRow, /\/admin\/species\/3\/scientific-names\/22/);
    });

    void test("the merge dialog counts the loser's Names by kind", () => {
      const html = render("admin/mergeSpeciesDialog.pug", {
        defunctSpecies: species,
        defunctNames: { common, scientific: [...scientific, { ...scientific[0], name_id: 23 }] },
      });
      assert.match(html, /1 common names, 2 scientific names/);
    });
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

/**
 * The approval email itemises its bonuses from the Points module, so a CARES
 * submission must show a CARES line - the omission that made the email's lines
 * fail to add up to the total it printed.
 */
void describe("Approval email bonus breakdown", () => {
  const renderApproval = pug.compileFile(
    path.join(__dirname, "../views/email/onApproval.pug"),
    { pretty: false }
  );

  const caresFish = {
    id: 9,
    species_common_name: "Endler Guppy",
    species_latin_name: "Poecilia wingei",
    species_class: "Livebearers",
    approved_on: new Date().toISOString(),
    points: 10,
    article_points: 0,
    first_time_species: false,
    cares_species: true,
    flowered: false,
    sexual_reproduction: false,
  };

  function render(submission: Record<string, unknown>) {
    return renderApproval({
      domain: "bap.basny.org",
      member: { display_name: "Jane Aquarist" },
      submission: { ...submission, total_points: 15 },
      bonusLines: bonusBreakdown(submission),
    });
  }

  void test("shows the CARES line for a CARES submission", () => {
    const html = render(caresFish);

    assert.match(html, /<li>CARES Species Bonus: \+5 points<\/li>/);
  });

  void test("omits the CARES line when the flag is not set", () => {
    const html = render({ ...caresFish, cares_species: false });

    assert.doesNotMatch(html, /CARES/);
  });

  void test("lists every bonus a row carries, and nothing else", () => {
    const html = render({
      ...caresFish,
      article_points: 5,
      first_time_species: true,
      flowered: true,
      sexual_reproduction: true,
    });

    assert.match(html, /<li>Base Points: 10<\/li>/);
    assert.match(html, /<li>Article Bonus: \+5 points<\/li>/);
    assert.match(html, /<li>First Time Species Bonus: \+5 points<\/li>/);
    assert.match(html, /<li>CARES Species Bonus: \+5 points<\/li>/);
    assert.match(html, /<li>Flowering Bonus: \+10 points<\/li>/);
    assert.match(html, /<li>Sexual Reproduction Bonus: \+10 points<\/li>/);
  });

  void test("shows only the base points when no bonus applies", () => {
    const html = render({
      ...caresFish,
      cares_species: false,
      article_points: null,
      first_time_species: null,
      flowered: null,
      sexual_reproduction: null,
    });

    assert.match(html, /<li>Base Points: 10<\/li>/);
    assert.doesNotMatch(html, /Bonus/);
  });
});
