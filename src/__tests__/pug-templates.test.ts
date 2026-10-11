import { describe, test } from "node:test";
import assert from "node:assert";
import pug from "pug";
import path from "path";
import fs from "fs";
import { faker } from "@faker-js/faker";
import { getNextLevel, programMetadata } from "../programs";
import { bonusBreakdown, bonusFields } from "../points";

/**
 * The approval queue page's locals (#527), as `approvalQueueLocals` in
 * src/routes/admin.ts builds them: one row ready with first-time, one that is
 * the viewer's own, one approved tonight and one still waiting.
 */
const sampleQueue = {
  title: "Approval queue",
  subtitle: "Every Program",
  program: null,
  queuePath: "/admin/queue",
  counts: { all: 2, fish: 1, plant: 1, coral: 0 },
  ready: [
    {
      id: 101,
      member_id: 7,
      member_name: "Jane Ortiz",
      firstName: "Jane",
      program: "fish",
      programShort: "BAP",
      species_common_name: "Butterfly Goodeid",
      species_latin_name: "Ameca splendens",
      newSpecies: true,
      preview: {
        lines: [
          { label: "Base points", amount: 10 },
          { label: "First Time Species Bonus", amount: 5 },
          { label: "CARES Species Bonus", amount: 5 },
        ],
        total: 20,
        firstTime: true,
      },
      witnessedOn: "08/02/2026",
      mine: false,
    },
    {
      id: 105,
      member_id: 1,
      member_name: "Alex Kim",
      firstName: "Alex",
      program: "plant",
      programShort: "HAP",
      species_common_name: "Wendt's Water Trumpet",
      species_latin_name: "Cryptocoryne wendtii",
      newSpecies: false,
      preview: { lines: [{ label: "Base points", amount: 10 }], total: 10, firstTime: false },
      witnessedOn: "08/05/2026",
      mine: true,
    },
  ],
  approvedTonight: [
    { id: 99, member_name: "Dan Wu", species_common_name: "Apisto Rio Mamuru", programShort: "BAP", total: 20, approvedBy: "Alex Kim" },
  ],
  waiting: [
    { id: 106, member_name: "Ken Ito", species_common_name: "Red-tailed Goodeid", programShort: "BAP", readyOn: "11/29/2026" },
  ],
};

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

  // The witness email's facts, as `witnessLetter` (src/notifications.ts) works them out
  const sampleWitnessLetter = {
    submissionId: 321,
    subject: "Witnessed: Guppy, 20 points pending approval",
    heading: "Your spawn has been witnessed",
    programAbbreviation: "BAP",
    programName: "Breeders Awards Program",
    witnessName: "Marcus Lee",
    witnessedOn: "October 9, 2026",
    speciesCommonName: "Guppy",
    speciesLatinName: "Poecilia reticulata",
    speciesClass: "Livebearers",
    reproductionLabel: "Reproduced",
    reproducedOn: "September 20, 2026",
    lines: [
      { label: "Base points", amount: 10 },
      { label: "Article Bonus", amount: 5 },
      { label: "CARES Species Bonus", amount: 5 },
    ],
    total: 20,
    laterBonuses: null,
    firstTime: true,
    readyOn: "November 19, 2026",
    keepFry: true,
    offspring: "fry",
  };

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
    // Rows for the templates that take a `submissions` local: the waiting
    // period queue (a queue row plus waitingStatus) and the re-witness letter
    // (RewitnessLetterRow, src/notifications.ts)
    submissions: [
      {
        ...createMockSubmission(),
        id: 41,
        species_common_name: "Guppy",
        species_latin_name: "Poecilia reticulata",
        species_type: "Fish",
        species_class: "Livebearers",
        reproduction_date: "2026-01-15",
        waitingStatus: { daysRemaining: 0 },
        reproducedOn: "January 15, 2026",
        witnessedBy: "Pat",
        witnessedOn: "February 1, 2026",
        readyOn: "March 16, 2026",
        waitingPeriodOver: true,
      },
    ],

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
      /^mixins\/bindSpeciesControls\.pug$/, // Mixin-only template
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
            templateData.witnessLetters = [sampleWitnessLetter];
            templateData.offspring = "fry";
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

          case "admin/queue.pug":
            Object.assign(templateData, sampleQueue);
            break;

          case "admin/approveSheet.pug":
            templateData.submission = { id: 42, member_name: "Sam Lee", species_common_name: "Butterfly Goodeid" };
            templateData.preview = { lines: [{ label: "Base points", amount: 10 }], total: 10, firstTime: false };
            templateData.expectedTotal = 15;
            templateData.message = null;
            templateData.queuePath = "/admin/queue";
            break;

          case "admin/witnessSummary.pug":
            templateData.summary = { ready: false, lines: [], total: 0, hint: "Choose the species first" };
            break;

          case "admin/witnessErrors.pug":
            templateData.messages = ["Choose a Species from the catalogue"];
            break;

          case "admin/witnessPanel.pug":
            templateData.spellingAgreement = null;
            templateData.speciesFacts = null;
            templateData.speciesChosenByWitness = false;
            templateData.suggestions = [];
            templateData.newSpecies = null;
            templateData.summary = { ready: false, lines: [], total: 0, hint: "Choose the species first" };
            templateData.allowed = { confirmWitness: false, bindSpecies: true, requestChanges: true };
            break;

          case "admin/recordSpeciesForm.pug":
            templateData.program = "fish";
            templateData.values = { new_scientific_name: "", new_common_name: "", new_point_class: null, new_cares_species: false };
            templateData.errors = new Map();
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

          case "email/onWitnessConfirmed.pug":
            templateData.domain = "example.com";
            templateData.letter = sampleWitnessLetter;
            break;

          case "email/onWaitingPeriodComplete.pug":
            templateData.offspring = "fry";
            break;

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
      ...(baseMockData.form as Record<string, unknown>),
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
   * The member's pick binds (CONTEXT.md, Bound). A bound form carries the
   * Species id and warns that editing its species fields will unbind it; an
   * unbound form carries no id and keeps the warning hidden until a pick.
   */
  void describe("Species binding notice", () => {
    const renderSubmit = pug.compileFile(path.join(viewsPath, "submit.pug"), {
      basedir: viewsPath,
      pretty: false,
    });
    const render = (form: Record<string, unknown>) =>
      renderSubmit({ ...baseMockData, formAction: "/submit", form: { ...(baseMockData.form as Record<string, unknown>), ...form } });
    const notice = (html: string) => /<div[^>]*id="species-binding-notice"[^>]*>/.exec(html)?.[0];

    void test("a bound form carries its Species and warns that editing will unbind", () => {
      const html = render({ id: 7, species_id: 12 });

      assert.match(html, /<input type="hidden" name="species_id" id="species_id" value="12">/);
      assert.ok(notice(html), "the notice is rendered");
      assert.doesNotMatch(notice(html)!, /hidden/);
      assert.match(html, /will unbind it/);
    });

    void test("an unbound form carries no Species and hides the warning", () => {
      const html = render({ id: 7, species_id: null });

      assert.match(html, /<input type="hidden" name="species_id" id="species_id" value="">/);
      assert.match(notice(html)!, /hidden/);
    });
  });

  /**
   * The species views read Names in the catalogue's shape - `name_id` and
   * `name`, by kind - and a refused delete has somewhere to say "merge".
   */
  /**
   * The witness panel sets the points (ADR-0003): the Species the member says
   * it is, Yes or No, then the base points and bonuses, summed by the server
   * into the sticky bar. It never says "bind".
   */
  void describe("Witness panel", () => {
    const facts = {
      speciesId: 7,
      speciesName: "Poecilia reticulata",
      commonName: "Guppy",
      speciesType: "Fish",
      programClass: "Livebearers",
      program: "fish",
      pointClass: 10,
      isFirstTime: false,
      priorBreedCount: 3,
      isCaresSpecies: true,
    };
    const ready = { ready: true, lines: [{ label: "Base points", amount: 10 }, { label: "CARES Species Bonus", amount: 5 }], total: 15, hint: null };
    const notReady = { ready: false, lines: [], total: 0, hint: "Is the species right? Answer above first" };
    const render = (data: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, "admin/witnessPanel.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: true,
        submission: {
          id: 42,
          program: "fish",
          species_type: "Fish",
          species_class: "Livebearers",
          species_common_name: "Guppy",
          species_latin_name: "Poecilia reticulata",
          member_name: "Jane Ortiz",
          reproduction_date: "Sep 20, 2026",
          article_link: null,
        },
        speciesFacts: facts,
        speciesChosenByWitness: false,
        classificationMismatch: false,
        spellingAgreement: { commonName: "name", latinName: "name" },
        suggestions: [],
        newSpecies: null,
        originalWitness: null,
        summary: notReady,
        allowed: { confirmWitness: true, bindSpecies: true, requestChanges: true },
        ...data,
      });
    /** Two catalogue neighbours of what the member wrote, as `suggestSpecies` shapes them for the panel. */
    const neighbours = [
      { speciesId: 8, commonName: "Butterfly Goodeid", speciesName: "Ameca splendens", speciesType: "Fish", programClass: "Livebearers", pointClass: 10 },
      { speciesId: 9, commonName: null, speciesName: "Ilyodon whitei", speciesType: "Fish", programClass: "Livebearers", pointClass: null },
    ];

    void test("header: member, Program, reproduction date, and a link to the form", () => {
      const html = render({});
      assert.match(html, /BAP submission · reproduced Sep 20, 2026/);
      assert.match(html, /Jane Ortiz/);
      assert.match(html, /href="#species-details"[^>]*>See the full form, photos and video</);
      assert.match(html, /Witness this submission/);
      assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /\bbind/i, "the panel never says bind");
    });

    void test("a reset Submission's header names the original witness, so no fresh sighting is asked for", () => {
      const html = render({ originalWitness: { name: "Pat", date: "01/02/2026" } });
      const header = html.slice(html.indexOf('id="witness-header"'), html.indexOf('id="witness-form"'));

      assert.match(header, /id="witness-original-witness"/);
      assert.match(header, /Originally witnessed by Pat on 01\/02\/2026\./);
      assert.match(header, /No fresh sighting is needed/);
      assert.doesNotMatch(render({}), /witness-original-witness/, "a Submission never reset says nothing about it");
    });

    void test("the member picked the Species: says so, asks Yes or No, and posts that Species", () => {
      const html = render({});

      assert.match(html, /The member says it&#39;s|The member says it's/);
      assert.match(html, /id="witness-bound-common"[^>]*>Guppy</);
      assert.match(html, /id="witness-bound-species"[^>]*>Poecilia reticulata</);
      assert.match(html, /Fish · Livebearers · Point class 10/);
      assert.match(html, /Is that right\?/);
      assert.match(html, /<input class="peer sr-only" type="radio" name="species_settled" value="1" id="witness-species-yes"\/>/);
      assert.match(html, /<input class="peer sr-only" type="radio" name="species_settled" value="0" id="witness-species-no"\/>/);
      assert.match(html, /<input type="hidden" name="species_id" value="7"\/>/);
      assert.match(html, /id="witness-form"[^>]*hx-post="\/admin\/submissions\/42\/confirm-witness"/);
      // The search is there for No, hidden until then
      assert.match(html, /class="mt-3 hidden group-has-\[#witness-species-no:checked\]:block" id="witness-species-other"/);
      assert.match(html, /hx-post="\/admin\/submissions\/42\/bind-species"/);
      assert.match(html, /Record new species/);
      assert.match(html, /hx-get="\/admin\/submissions\/42\/record-species"/);
      assert.doesNotMatch(html, /dialog\/species\/new/, "the dialog that created and bound outside the Witness is not the panel's");
    });

    void test("No on the member's pick leads to the suggestions, the search and Record new species", () => {
      const html = render({ suggestions: neighbours });
      const other = html.slice(html.indexOf('id="witness-species-other"'), html.indexOf('id="witness-points"'));

      assert.match(other, /Which species is it\?/);
      assert.match(other, /Did they mean one of these\?/);
      assert.match(other, /id="witness-suggestion-8"/);
      assert.match(other, /Butterfly Goodeid/);
      assert.match(other, /Ameca splendens/);
      assert.match(other, /Fish · Livebearers · Point class 10/);
      assert.match(other, /id="witness-suggestion-9"/);
      assert.match(other, /Ilyodon whitei/);
      assert.match(other, /no Point class yet/);
      assert.match(other, /hx-post="\/admin\/submissions\/42\/bind-species"[^>]*hx-vals="\{&quot;group_id&quot;:8\}"[^>]*>This one</);
      assert.match(other, /name="group_id"[^>]*data-api-url="\/api\/species\/search"/);
      assert.match(other, /Record new species/);
    });

    void test("the Points card is gated until Yes, and the base points are prefilled from the Point class", () => {
      const html = render({});

      assert.match(html, /class="[^"]*opacity-40 pointer-events-none group-has-\[#witness-species-yes:checked\]:opacity-100[^"]*" id="witness-points"/);
      assert.match(html, /<input class="peer sr-only" type="radio" name="points" value="10" id="witness-points-10" checked="checked"\/>/);
      for (const pc of [5, 15, 20]) {
        assert.match(html, new RegExp(`<input class="peer sr-only" type="radio" name="points" value="${pc}" id="witness-points-${pc}"\\/>`));
      }
      assert.match(html, /From the Species&#39; Point class \(10\)|From the Species' Point class \(10\)/);
    });

    void test("bonuses per Program: CARES on BAP prefilled from the catalogue, article None/+5/+10, flowered and sexual reproduction on HAP only", () => {
      const bap = render({});
      assert.match(bap, /<input class="peer sr-only" type="checkbox" name="cares_species" value="on" checked="checked"\/>/);
      assert.match(bap, /Listed in the catalogue/);
      assert.match(bap, /name="article_points" value="0" id="witness-article-0" checked="checked"/);
      assert.match(bap, /name="article_points" value="5" id="witness-article-5"\/>/);
      assert.match(bap, /name="article_points" value="10" id="witness-article-10"\/>/);
      assert.match(bap, /Only if it is already written/);
      assert.doesNotMatch(bap, /name="flowered"|name="sexual_reproduction"/);
      assert.doesNotMatch(bap, /name="first_time_species"/, "first-time is approval's to compute");

      const hap = render({
        submission: {
          id: 42,
          program: "plant",
          species_type: "Plant",
          species_class: "Cryptocoryne",
          species_common_name: "Wendt's water trumpet",
          species_latin_name: "Cryptocoryne wendtii",
          member_name: "Priya Shah",
          reproduction_date: "Sep 12, 2026",
          article_link: "https://example.com/article",
        },
        speciesFacts: { ...facts, speciesType: "Plant", programClass: "Cryptocoryne", program: "plant", isCaresSpecies: false },
      });
      assert.doesNotMatch(hap, /name="cares_species"/);
      assert.match(hap, /<input class="peer sr-only" type="checkbox" name="flowered" value="on"\/>/);
      assert.match(hap, /<input class="peer sr-only" type="checkbox" name="sexual_reproduction" value="on"\/>/);
      assert.match(hap, /name="article_points" value="5" id="witness-article-5" checked="checked"/, "+5 when the member linked an article");
      assert.match(hap, /The member linked one/);
      assert.match(hap, /HAP submission/);
    });

    void test("the bonuses offered are the bound Species' Program's, since confirming adopts it", () => {
      // A plant Submission bound to a Fish Species is about to be a BAP row:
      // CARES is offered, flowered and sexual reproduction are not
      const plantOnFish = render({
        submission: {
          id: 42,
          program: "plant",
          species_type: "Plant",
          species_class: "Cryptocoryne",
          species_common_name: "Guppy",
          species_latin_name: "Poecilia reticulata",
          member_name: "Priya Shah",
          reproduction_date: "Sep 12, 2026",
          article_link: null,
        },
        classificationMismatch: true,
      });
      assert.match(plantOnFish, /HAP submission/, "the header says what the member filed");
      assert.match(plantOnFish, /name="cares_species"/);
      assert.doesNotMatch(plantOnFish, /name="flowered"|name="sexual_reproduction"/);
      assert.match(
        plantOnFish,
        /id="witness-mismatch"[^>]*>The submission says Plant · Cryptocoryne\. Confirming records it as Fish · Livebearers and moves it to BAP\./
      );

      // And a fish Submission bound to a Plant Species offers the HAP bonuses
      const fishOnPlant = render({
        speciesFacts: { ...facts, speciesType: "Plant", programClass: "Cryptocoryne", program: "plant", isCaresSpecies: false },
      });
      assert.doesNotMatch(fishOnPlant, /name="cares_species"/);
      assert.match(fishOnPlant, /name="flowered"/);
      assert.match(fishOnPlant, /name="sexual_reproduction"/);
    });

    void test("the first-time line is informational: never a control", () => {
      assert.match(render({}), /id="witness-first-time"[^>]*>Approved 3 times before, so no first-time bonus\.</);
      assert.match(
        render({ speciesFacts: { ...facts, isFirstTime: true, priorBreedCount: 0 } }),
        /No one has had this species approved yet/
      );
      assert.match(render({ speciesFacts: { ...facts, priorBreedCount: 1 } }), /Approved 1 time before/);
    });

    void test("a Species with no Point class: nothing prefilled, and the chosen base points become its Point class", () => {
      const html = render({ speciesFacts: { ...facts, pointClass: null } });
      assert.doesNotMatch(html, /name="points"[^>]*checked/);
      assert.match(html, /no Point class yet/);
      assert.match(html, /id="witness-no-point-class"[^>]*>The catalogue has no Point class for this Species\. The base points you choose become its Point class\./);
    });

    void test("the witness chose the Species: settled already, no Yes or No, the member's spelling shown, and a way to choose another", () => {
      const html = render({
        speciesChosenByWitness: true,
        submission: {
          id: 42,
          program: "fish",
          species_type: "Fish",
          species_class: "Livebearers",
          species_common_name: "Millions fish",
          species_latin_name: "Poecilia reticulatta",
          member_name: "Jane Ortiz",
          reproduction_date: "Sep 20, 2026",
        },
        summary: ready,
      });

      assert.match(html, /You chose/);
      assert.doesNotMatch(html, /Is that right/);
      assert.match(html, /<input type="hidden" name="species_settled" value="1"\/>/);
      assert.match(html, /Member wrote: Millions fish · Poecilia reticulatta/);
      assert.match(html, /Wrong species\? Choose another/);
      assert.match(html, /<input class="peer sr-only" type="checkbox" id="witness-species-no"\/>/);
      assert.match(html, /class="bg-white rounded-lg p-4 text-gray-900" id="witness-points"/, "the Points card is open");
    });

    void test("unbound: shows what the member wrote, the suggestions, the search and Record new species, and the Points card closed", () => {
      const html = render({
        speciesFacts: null,
        spellingAgreement: null,
        suggestions: neighbours,
        summary: { ready: false, lines: [], total: 0, hint: "Choose the species first" },
      });

      assert.match(html, /The member wrote/);
      assert.match(html, /Poecilia reticulata/);
      assert.doesNotMatch(html, /name="species_id"|Is that right|Which species is it/);
      assert.match(html, /class="mt-3" id="witness-species-other"/, "the search is open");
      assert.match(html, /Did they mean one of these\?/);
      assert.match(html, /id="witness-suggestion-8"/);
      assert.match(html, /hx-post="\/admin\/submissions\/42\/bind-species"[^>]*hx-vals="\{&quot;group_id&quot;:9\}"[^>]*>This one</);
      assert.match(html, /<select[^>]*name="group_id"[^>]*data-api-url="\/api\/species\/search"/);
      assert.match(html, /Use this species/);
      assert.match(html, /Not in the catalogue\?/);
      // Record new species: a grey secondary button that swaps the record form into the Species card
      assert.match(
        html,
        /<button class="outline w-full mt-1" id="witness-species-new" type="button" hx-get="\/admin\/submissions\/42\/record-species" hx-target="#witness-species" hx-swap="innerHTML">Record new species</
      );
      assert.match(html, /class="bg-white rounded-lg p-4 text-gray-900 opacity-40 pointer-events-none" id="witness-points"/);
      assert.match(html, /Choose the species first/);
      assert.match(html, /id="witness-confirm"[^>]*disabled/);
    });

    void test("unbound with nothing close in the catalogue: no suggestions heading, just the search and Record new species", () => {
      const html = render({ speciesFacts: null, spellingAgreement: null, suggestions: [] });
      assert.doesNotMatch(html, /Did they mean one of these|witness-suggestion-/);
      assert.match(html, /Use this species/);
      assert.match(html, /Record new species/);
    });

    /**
     * After Record species and continue: the panel comes back with the new
     * Species settled but not yet created. Its details ride in hidden fields
     * for the confirm to create it in the Witness's transaction; the Points
     * card is open and prefilled from the Point class and CARES the witness
     * chose. Abandoning the page creates nothing.
     */
    void test("recording a new Species: settled, carried in hidden fields, the Points card open and prefilled from it", () => {
      const html = render({
        speciesFacts: null,
        spellingAgreement: null,
        submission: {
          id: 42,
          program: "fish",
          species_type: "Fish",
          species_class: "Cichlids - New World",
          species_common_name: "Apisto Rio Mamuru",
          species_latin_name: "Apistogramma sp. Rio Mamuru",
          member_name: "Dan Wu",
          reproduction_date: "Sep 28, 2026",
          article_link: null,
        },
        newSpecies: {
          scientificName: "Apistogramma sp. 'Rio Mamuru'",
          commonName: "Apisto Rio Mamuru",
          speciesType: "Fish",
          programClass: "Cichlids - New World",
          program: "fish",
          pointClass: 15,
          isCaresSpecies: true,
        },
        summary: { ready: true, lines: [{ label: "Base points", amount: 15 }, { label: "CARES Species Bonus", amount: 5 }], total: 20, hint: null },
      });

      assert.match(html, /id="witness-recording"/);
      assert.match(html, /You(&#39;|')re recording a new species/);
      assert.match(html, /id="witness-bound-common"[^>]*>Apisto Rio Mamuru</);
      assert.match(html, /id="witness-bound-species"[^>]*>Apistogramma sp\. (&#39;|')Rio Mamuru(&#39;|')</);
      assert.match(html, /Fish · Cichlids - New World · Point class 15 · CARES/);
      assert.match(html, /Member wrote: Apisto Rio Mamuru · Apistogramma sp\. Rio Mamuru/);
      assert.match(html, /Wrong species\? Choose another/);
      // The new Species rides to the confirm in hidden fields, inside the card so choosing another drops them
      assert.match(html, /<input type="hidden" name="new_scientific_name" value="Apistogramma sp\. (&#39;|')Rio Mamuru(&#39;|')"\/>/);
      assert.match(html, /<input type="hidden" name="new_common_name" value="Apisto Rio Mamuru"\/>/);
      assert.match(html, /<input type="hidden" name="new_point_class" value="15"\/>/);
      assert.match(html, /<input type="hidden" name="new_cares_species" value="on"\/>/);
      assert.match(html, /<input type="hidden" name="species_settled" value="1"\/>/);
      assert.doesNotMatch(html, /name="species_id"|Is that right|witness-names/);
      // Points: open, prefilled from what the witness chose for the Species
      assert.match(html, /class="bg-white rounded-lg p-4 text-gray-900" id="witness-points"/, "the Points card is open");
      assert.match(html, /<input class="peer sr-only" type="radio" name="points" value="15" id="witness-points-15" checked="checked"\/>/);
      assert.match(html, /id="witness-point-class"[^>]*>From the Point class you chose \(15\)\.</);
      assert.match(html, /<input class="peer sr-only" type="checkbox" name="cares_species" value="on" checked="checked"\/>/);
      assert.match(html, /Not yet in the catalogue/);
      assert.match(html, /id="witness-first-time"[^>]*>No one has had this species approved yet/);
      assert.match(html, /id="witness-confirm"[^>]*type="submit">Confirm witness · 20 pts</);
    });

    void test("recording a Plant: the HAP switches, no CARES, and no new_cares_species field", () => {
      const html = render({
        speciesFacts: null,
        spellingAgreement: null,
        submission: {
          id: 42,
          program: "plant",
          species_type: "Plant",
          species_class: "Cryptocoryne",
          species_common_name: "Mamuru crypt",
          species_latin_name: "Cryptocoryne mamuruensis",
          member_name: "Priya Shah",
          reproduction_date: "Sep 12, 2026",
          article_link: null,
        },
        newSpecies: {
          scientificName: "Cryptocoryne mamuruensis",
          commonName: null,
          speciesType: "Plant",
          programClass: "Cryptocoryne",
          program: "plant",
          pointClass: 10,
          isCaresSpecies: false,
        },
        summary: ready,
      });
      assert.match(html, /name="flowered"/);
      assert.match(html, /name="sexual_reproduction"/);
      assert.doesNotMatch(html, /name="cares_species"|name="new_cares_species"|name="new_common_name"/);
      assert.match(html, /id="witness-bound-common"[^>]*>Cryptocoryne mamuruensis</, "no common name: the scientific one stands in");
      assert.match(html, /Plant · Cryptocoryne · Point class 10</);
    });

    void test("a classification mismatch is said, not refused: confirming records the Species' values", () => {
      const html = render({
        submission: {
          id: 42,
          program: "fish",
          species_type: "Invert",
          species_class: "Shrimp",
          species_common_name: "Guppy",
          species_latin_name: "Poecilia reticulata",
          member_name: "Jane Ortiz",
          reproduction_date: "Sep 20, 2026",
        },
        classificationMismatch: true,
      });
      assert.match(html, /id="witness-mismatch"[^>]*>The submission says Invert · Shrimp\. Confirming records it as Fish · Livebearers\./);
      assert.match(html, /Is that right/);
      assert.doesNotMatch(html, /adopt-species-classification/);
    });

    void test("Names to add: offered only where the spelling is not a Name, common ticked and Latin unticked", () => {
      const spelt = {
        id: 42,
        program: "fish",
        species_type: "Fish",
        species_class: "Livebearers",
        species_common_name: "Fancy Guppy",
        species_latin_name: "Poecilia reticulatta",
        member_name: "Jane Ortiz",
        reproduction_date: "Sep 20, 2026",
      };
      let html = render({ submission: spelt, spellingAgreement: { commonName: "not-a-name", latinName: "not-a-name" } });
      assert.match(html, /id="witness-names"/);
      assert.match(html, /<input class="mt-1" type="checkbox" name="add_common_name" value="on" checked="checked"\/>/);
      assert.match(html, /<input class="mt-1" type="checkbox" name="add_scientific_name" value="on"\/>/);
      assert.match(html, /Fancy Guppy/);
      assert.match(html, /Poecilia reticulatta/);

      html = render({ submission: spelt, spellingAgreement: { commonName: "name", latinName: "name" } });
      assert.doesNotMatch(html, /witness-names|add_common_name|add_scientific_name/);

      html = render({ submission: spelt, spellingAgreement: { commonName: "scientific-name", latinName: "not-a-name" } });
      assert.doesNotMatch(html, /add_common_name/);
      assert.match(html, /add_scientific_name/);

      html = render({ submission: { ...spelt, species_common_name: "" }, spellingAgreement: { commonName: "empty", latinName: "not-a-name" } });
      assert.doesNotMatch(html, /add_common_name/);
    });

    void test("the sticky bar: the server's sum and the Confirm button, refreshed on every change", () => {
      const html = render({ summary: ready });
      assert.match(html, /id="witness-footer"[^>]*hx-post="\/admin\/submissions\/42\/witness-summary"/);
      assert.match(html, /hx-trigger="change from:#witness-form"/);
      assert.match(html, /hx-include="#witness-form"/);
      assert.match(html, /id="witness-sum-lines">Base points 10 \+ CARES Species Bonus 5</);
      assert.match(html, /id="witness-sum-total">15 pts</);
      assert.match(html, /id="witness-confirm"[^>]*type="submit">Confirm witness · 15 pts</);
      assert.doesNotMatch(html, /id="witness-confirm"[^>]*disabled/);

      const waiting = render({ summary: notReady });
      assert.match(waiting, /id="witness-sum-hint">Is the species right\? Answer above first</);
      assert.match(waiting, /id="witness-confirm"[^>]*disabled/);
    });

    void test("while changes are outstanding the panel offers nothing: the ball is with the member", () => {
      const html = render({ changesRequested: true, allowed: { confirmWitness: false, bindSpecies: false, requestChanges: false } });
      assert.match(html, /id="witness-waiting-on-member"/);
      assert.match(html, /Changes were requested/);
      assert.doesNotMatch(html, /witness-form|confirm-witness|name="points"/);
    });

    void test("Request changes is offered; without the moves, no search and no Request changes", () => {
      assert.match(render({}), /hx-get="\/admin\/dialog\/submissions\/42\/request-changes"[^>]*>Request changes</);
      const html = render({ allowed: { confirmWitness: true } });
      assert.doesNotMatch(html, /bind-species|record-species|request-changes/);
    });

    /**
     * The Record new species step, swapped into the Species card: names
     * prefilled from the member's spelling, type and class from the
     * Submission, the Point class and CARES to choose. Nothing is created
     * until the Witness is confirmed.
     */
    void describe("Record new species form", () => {
      const renderForm = (data: Record<string, unknown>) =>
        pug.compileFile(path.join(viewsPath, "admin/recordSpeciesForm.pug"), { basedir: viewsPath, pretty: false })({
          ...baseMockData,
          submission: { id: 42, species_type: "Fish", species_class: "Cichlids - New World" },
          program: "fish",
          values: { new_scientific_name: "Apistogramma sp. Rio Mamuru", new_common_name: "Apisto Rio Mamuru", new_point_class: null, new_cares_species: false },
          errors: new Map(),
          ...data,
        });

      void test("prefilled from the member's spelling, with the Submission's type and class, Point class and CARES to choose", () => {
        const html = renderForm({});

        assert.match(html, /id="witness-record"/);
        assert.match(html, /Record new species/);
        assert.match(html, /<input[^>]*name="new_scientific_name"[^>]*value="Apistogramma sp\. Rio Mamuru"/);
        assert.match(html, /<input[^>]*name="new_common_name"[^>]*value="Apisto Rio Mamuru"/);
        assert.match(html, /Fish · Cichlids - New World/);
        for (const pc of [5, 10, 15, 20]) {
          assert.match(html, new RegExp(`<input class="peer sr-only" type="radio" name="new_point_class" value="${pc}" id="witness-new-point-class-${pc}"\\/>`));
        }
        assert.match(html, /This submission(&#39;|')s base points, and every later one(&#39;|')s\./);
        assert.match(html, /<input[^>]*type="checkbox"[^>]*name="new_cares_species"[^>]*value="on"/);
        assert.match(
          html,
          /<button class="primary w-full h-12 text-base" id="witness-record-continue" type="button" hx-post="\/admin\/submissions\/42\/record-species" hx-include="#witness-record" hx-target="#witness-species" hx-swap="innerHTML">Record species and continue</
        );
        // Back fetches the page and keeps only the panel, so nothing is created or lost
        assert.match(html, /hx-get="\/submissions\/42"[^>]*hx-select="#witnessPanel"[^>]*hx-target="#witnessPanel"[^>]*hx-swap="outerHTML"[^>]*>Back</);
        assert.doesNotMatch(html, /<form/, "it sits inside the panel's form, so it is not one itself");
      });

      void test("a Plant has no CARES to choose; a chosen Point class and CARES come back ticked, with the refusals beside their fields", () => {
        const plant = renderForm({
          submission: { id: 42, species_type: "Plant", species_class: "Cryptocoryne" },
          program: "plant",
        });
        assert.doesNotMatch(plant, /new_cares_species/);

        const refused = renderForm({
          values: { new_scientific_name: "Apistogramma", new_common_name: "", new_point_class: 15, new_cares_species: true },
          errors: new Map([["new_scientific_name", "Give the scientific name as genus and species, like Poecilia reticulata"]]),
        });
        assert.match(refused, /<input class="peer sr-only" type="radio" name="new_point_class" value="15" id="witness-new-point-class-15" checked="checked"\/>/);
        assert.match(refused, /name="new_cares_species"[^>]*checked="checked"/);
        assert.match(refused, /id="new_scientific_name-error"[^>]*>Give the scientific name as genus and species, like Poecilia reticulata</);
      });
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
  });

  /**
   * Approval is about Points: the bound Species read-only with its Point
   * class, the Points and bonuses prefilled from what the Witness set (or the
   * Point class, before it did), and no species step at all.
   */
  /**
   * The approval queue page (#527): one list, tap twice. Each ready row
   * shows the member, Program, Species and total; opening it shows the
   * itemised points, first-time, the witness date and the links; Approve is
   * a label that arms a checkbox, "Tap again" the submit, Cancel the same
   * label. The viewer's own rows get no button.
   */
  void describe("Approval queue page", () => {
    const render = (data: Record<string, unknown> = {}) =>
      pug.compileFile(path.join(viewsPath, "admin/queue.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: true,
        ...sampleQueue,
        ...data,
      });

    void test("a ready row: member, Program, Species, the new-species note and the total", () => {
      const html = render();

      assert.match(html, /<details[^>]*id="queue-row-101"/);
      assert.match(html, /Jane Ortiz/);
      assert.match(html, /<span[^>]*>BAP<\/span>/);
      assert.match(html, /Butterfly Goodeid/);
      assert.match(html, /Butterfly Goodeid <i class="text-gray-500">Ameca splendens<\/i>/);
      assert.match(html, /id="queue-new-species-101"[^>]*>New species recorded by the witness</);
      assert.match(html, /id="queue-total-101"[^>]*>20</);
      assert.doesNotMatch(html, /queue-new-species-105/);
    });

    void test("opened, a row itemises the points with first-time, names the witness date and links to the Submission and the correction", () => {
      const html = render();

      assert.match(html, /id="queue-lines-101"[^>]*>Base points 10 \+ First Time Species Bonus 5 \+ CARES Species Bonus 5</);
      assert.match(html, /id="queue-first-time-101"[^>]*>First approval of this species · \+5 goes to whoever is approved first</);
      assert.doesNotMatch(html, /queue-first-time-105/);
      assert.match(html, /Witnessed 08\/02\/2026/);
      assert.match(html, /href="\/submissions\/101"[^>]*>full Submission</);
      assert.match(html, /href="\/admin\/submissions\/101\/correct-points"[^>]*>correct points</);
    });

    void test("Approve posts the total it shows, armed by a first tap and confirmed by a second; Cancel disarms", () => {
      const html = render();

      assert.match(html, /<form hx-post="\/admin\/submissions\/101\/approve"/);
      assert.match(html, /<input type="hidden" name="expected_total" value="20">/);
      assert.match(html, /<input class="peer sr-only" type="checkbox" id="queue-arm-101"/);
      assert.match(html, /<label class="[^"]*peer-checked:hidden[^"]*" for="queue-arm-101" id="queue-approve-101">Approve · 15 pts \+ 5 first-time</);
      assert.match(html, /<button[^>]*type="submit" id="queue-confirm-101"[^>]*>Tap again: Jane brought it · 20 pts</);
      assert.match(html, /<label[^>]*for="queue-arm-101"[^>]*id="queue-cancel-101"[^>]*>Cancel</);
      const list = html.slice(html.indexOf('id="queue-ready"'), html.indexOf('id="queue-waiting"'));
      assert.doesNotMatch(list, /<script|onclick|hx-on/, "arming is a checkbox the buttons read, not a script");
    });

    void test("without first-time the button says the plain total", () => {
      const html = render({ ready: [{ ...sampleQueue.ready[0], mine: false, preview: { lines: [{ label: "Base points", amount: 10 }], total: 10, firstTime: false } }] });
      assert.match(html, /id="queue-approve-101"[^>]*>Approve · 10 pts</);
    });

    void test("the viewer's own row has no button: another committee member approves it", () => {
      const html = render();

      assert.match(html, /id="queue-own-105"[^>]*>Your own Submission\. Another committee member approves it\.</);
      assert.doesNotMatch(html, /submissions\/105\/approve|queue-arm-105|queue-approve-105/);
    });

    void test("approved tonight and still waiting are listed, the latter greyed with a ready date and no button", () => {
      const html = render();

      assert.match(html, /id="queue-approved-99"[^>]*>[\s\S]*?✓ Dan Wu · Apisto Rio Mamuru[\s\S]*?by Alex Kim[\s\S]*?<b[^>]*>20 pts</);
      assert.match(html, /opacity-75" id="queue-waiting-106">[\s\S]*?Ken Ito · Red-tailed Goodeid[\s\S]*?ready 11\/29\/2026/);
      assert.doesNotMatch(html, /submissions\/106\/approve|submissions\/99\/approve/);
    });

    void test("the empty queue says so, and the sheet placeholder is there for a refusal to land in", () => {
      const html = render({ ready: [], approvedTonight: [], waiting: [] });

      assert.match(html, /id="queue-ready-empty"[^>]*>Nothing left to approve\.</);
      assert.doesNotMatch(html, /queue-approved"|Approved tonight/);
      assert.match(html, /id="queue-waiting-empty"/);
      assert.match(html, /<div id="approve-sheet"><\/div>/);
    });

    void test("the Program chips carry the counts and mark the one listed", () => {
      const html = render({ program: "plant" });

      assert.match(html, /href="\/admin\/queue">All · 2</);
      assert.match(html, /bg-white text-gray-900[^>]*href="\/admin\/queue\/plant">HAP · 1</);
      assert.match(html, /text-gray-200[^>]*href="\/admin\/queue\/fish">BAP · 1</);
    });
  });

  /**
   * The sheet a refused approval comes back as (#527): the fresh total and a
   * fresh Approve when the points changed, or the refusal itself.
   */
  void describe("Approve sheet", () => {
    const render = (data: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, "admin/approveSheet.pug"), { basedir: viewsPath, pretty: false })({
        submission: { id: 102, member_name: "Sam Lee", species_common_name: "Butterfly Goodeid" },
        queuePath: "/admin/queue/fish",
        preview: null,
        expectedTotal: null,
        message: null,
        ...data,
      });

    void test("the points changed: says the new total, why, and offers it", () => {
      const html = render({
        preview: { lines: [{ label: "Base points", amount: 10 }, { label: "CARES Species Bonus", amount: 5 }], total: 15, firstTime: false },
        expectedTotal: 20,
      });

      assert.match(html, /<div class="[^"]*" id="approve-sheet" role="dialog"/);
      assert.match(html, /id="approve-sheet-title">The points changed</);
      assert.match(html, /id="approve-sheet-why">Someone approved another Butterfly Goodeid first, so the first-time \+5 has gone\. Sam Lee now gets <b>15 pts<\/b>, not 20\.</);
      assert.match(html, /id="approve-sheet-lines">Base points 10 \+ CARES Species Bonus 5</);
      assert.match(html, /<form hx-post="\/admin\/submissions\/102\/approve"/);
      assert.match(html, /<input type="hidden" name="expected_total" value="15"\/>/);
      assert.match(html, /id="approve-sheet-approve"[^>]*>Approve · 15 pts</);
      assert.match(html, /id="approve-sheet-close" href="\/admin\/queue\/fish">Not now</);
    });

    void test("a change that is not the first-time bonus is not blamed on it", () => {
      const html = render({
        preview: { lines: [{ label: "Base points", amount: 20 }], total: 20, firstTime: false },
        expectedTotal: 10,
      });
      assert.doesNotMatch(html, /Someone approved another/);
      assert.match(html, /Sam Lee now gets <b>20 pts<\/b>, not 10\./);
    });

    void test("any other refusal says what was refused", () => {
      const html = render({ message: "Cannot approve a submission that is approved" });

      assert.match(html, /id="approve-sheet-title">Not approved</);
      assert.match(html, /id="approve-sheet-message">Cannot approve a submission that is approved</);
      assert.doesNotMatch(html, /\/approve"|expected_total/);
      assert.match(html, /Not now/);
    });
  });

  /**
   * The committee's view of a Submission in the approval queue (#527): no
   * form, just what approving would award and the way to the queue page.
   */
  void describe("Review page points the committee at the approval queue", () => {
    const render = (data: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, "submission/review.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: true,
        isSelf: false,
        photos: [],
        state: "inApprovalQueue",
        changesRequested: false,
        allowed: { requestChanges: true, deleteSubmission: true, bindSpecies: true },
        waitingPeriodStatus: { requiredDays: 60, elapsedDays: 70, daysRemaining: 0, elapsed: true },
        submission: { ...(baseMockData.submission as Record<string, unknown>), id: 77, species_id: 5, species_type: "Fish", points: 10, member_name: "Dan Wu" },
        approvalPreview: { lines: [{ label: "Base points", amount: 10 }, { label: "First Time Species Bonus", amount: 5 }], total: 15, firstTime: true },
        speciesRecordedByWitness: false,
        ...data,
      });

    void test("says what approval would award and links to the queue; no form", () => {
      const html = render({});

      assert.match(html, /id="approval-ready"/);
      assert.match(html, /id="approval-preview">Base points 10 \+ First Time Species Bonus 5 = <b>15 pts<\/b></);
      assert.match(html, /id="approval-first-time"/);
      assert.match(html, /once Dan Wu has brought the fry\./);
      assert.match(html, /id="approval-queue-link" href="\/admin\/queue#queue-row-77"/);
      assert.doesNotMatch(html, /\/approve"|name="points"|first_time_species|Approve</);
      assert.match(html, /Request Changes/);
      assert.match(html, /hx-delete="\/submissions\/77"/);
    });

    void test("a Species the witness recorded is said so; no first-time line when it is not a first", () => {
      const html = render({
        speciesRecordedByWitness: true,
        approvalPreview: { lines: [{ label: "Base points", amount: 10 }], total: 10, firstTime: false },
      });
      assert.match(html, /id="approval-new-species"[^>]*>New species recorded by the witness</);
      assert.doesNotMatch(html, /approval-first-time/);
    });
  });

  /**
   * Between the Witness and the queue, a Submission witnessed before binding
   * existed can be unbound; the admin panel offers the committee's bind.
   */
  void describe("Review page between the Witness and the queue", () => {
    const render = (submission: Record<string, unknown>, allowed: Record<string, boolean>) =>
      pug.compileFile(path.join(viewsPath, "submission/review.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: true,
        isSelf: false,
        photos: [],
        state: "waitingPeriod",
        changesRequested: false,
        allowed: { requestChanges: true, deleteSubmission: true, ...allowed },
        waitingPeriodStatus: { requiredDays: 60, elapsedDays: 10, daysRemaining: 50, elapsed: false },
        submission: { ...(baseMockData.submission as Record<string, unknown>), id: 77, ...submission },
      });

    void test("unbound: offers the bind and New Species", () => {
      const html = render({ species_id: null }, { bindSpecies: true });

      assert.match(html, /Not bound to a Species/);
      assert.match(html, /hx-post="\/admin\/submissions\/77\/bind-species"/);
      assert.match(html, /hx-get="\/admin\/dialog\/species\/new\?submission_id=77"/);
      assert.match(html, /id="committee-error"/);
    });

    void test("bound: no species step", () => {
      const html = render({ species_id: 5 }, { bindSpecies: true });

      assert.doesNotMatch(html, /bind-species"|dialog\/species\/new/);
      assert.match(html, /Request Changes/);
    });
  });

  void describe("Review page tells the member what to bring", () => {
    const render = (state: string, species_type: string) =>
      pug.compileFile(path.join(viewsPath, "submission/review.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: false,
        isSelf: true,
        photos: [],
        state,
        changesRequested: false,
        allowed: {},
        waitingPeriodStatus: { requiredDays: 60, elapsedDays: 10, daysRemaining: 50, elapsed: false },
        submission: { ...(baseMockData.submission as Record<string, unknown>), id: 77, species_id: 5, species_type },
      });

    void test("waiting period: fish bring fry", () => {
      const html = render("waitingPeriod", "Fish");

      assert.match(html, /Bring fry to a monthly auction/);
      assert.doesNotMatch(html, /Bring (the )?undefined/);
    });

    void test("in the approval queue: plants and corals bring what they propagated, and there is nothing to click", () => {
      const plant = render("inApprovalQueue", "Plant");
      assert.match(plant, /Bring the plants to a monthly meeting/);
      assert.match(render("inApprovalQueue", "Coral"), /Bring the corals to a monthly meeting/);
      assert.doesNotMatch(plant, /final-submit|Brought to Meeting|Remove from Queue|enter the approval queue/);
    });
  });

  /**
   * Points a witness set but the committee has not awarded are the owner's to
   * see (#523): on their Submission page as the itemised breakdown the witness
   * email uses, and on their submissions list. The route passes pendingPoints
   * for the owner alone, so these renders prove what each shape of local shows
   * and that an unapproved page offers no awarded-points fields to anyone.
   */
  void describe("The owner sees pending points", () => {
    const pending = {
      lines: [
        { label: "Base points", amount: 10 },
        { label: "Article Bonus", amount: 5 },
        { label: "CARES Species Bonus", amount: 5 },
      ],
      total: 20,
    };
    const review = (locals: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, "submission/review.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isAdmin: false,
        isSelf: true,
        isApproved: false,
        photos: [],
        state: "waitingPeriod",
        changesRequested: false,
        allowed: {},
        pendingPoints: null,
        waitingPeriodStatus: { requiredDays: 60, elapsedDays: 10, daysRemaining: 50, elapsed: false },
        submission: {
          ...(baseMockData.submission as Record<string, unknown>),
          id: 77,
          species_id: 5,
          points: 10,
          total_points: 20,
          witnessed: "Jane Ortiz - Oct 9, 2026",
        },
        ...locals,
      });

    void test("Submission page: the owner's breakdown, labelled pending approval, adding up to the total", () => {
      const html = review({ pendingPoints: pending });

      assert.match(html, /id="pending-points"/);
      assert.match(html, /Base points<\/td><td[^>]*>10</);
      assert.match(html, /Article Bonus<\/td><td[^>]*>\+5</);
      assert.match(html, /CARES Species Bonus<\/td><td[^>]*>\+5</);
      assert.match(html, /pending approval/);
      assert.match(html, /id="pending-points-total">20 pts</);
      assert.match(html, /Set at the Witness \(Jane Ortiz - Oct 9, 2026\)/);
      assert.doesNotMatch(html, /name="total_points"|name="points"/, "awarded-points fields wait for approval");
    });

    void test("Submission page: without the owner's local there is no breakdown, and no awarded points before approval", () => {
      const html = review({ isSelf: false, isAdmin: true, allowed: { requestChanges: true } });

      assert.doesNotMatch(html, /pending-points|pending approval/);
      assert.doesNotMatch(html, /name="total_points"|name="points"/);
    });

    void test("Submission page: an approved Submission shows the awarded points as before", () => {
      const html = review({
        isApproved: true,
        state: "approved",
        submission: { ...(baseMockData.submission as Record<string, unknown>), id: 77, points: 10, total_points: 20, approved: "Sam Lee - Oct 20, 2026" },
      });

      assert.match(html, /name="points"[^>]*/);
      assert.match(html, /value="20"[^>]*name="total_points"|name="total_points"[^>]*value="20"/);
      assert.doesNotMatch(html, /pending-points|pending approval/);
    });

    const memberPage = (rows: Record<string, unknown>[], totals = 0) =>
      pug.compileFile(path.join(viewsPath, "member.pug"), { basedir: viewsPath, pretty: false })({
        ...baseMockData,
        isSelf: true,
        isAdmin: false,
        fishSubs: rows,
        plantSubs: [],
        coralSubs: [],
        fishTotalPoints: totals,
        plantTotalPoints: 0,
        coralTotalPoints: 0,
      });
    const row = (overrides: Record<string, unknown>) => ({
      id: 5,
      species_class: "Livebearers",
      species_common_name: "Guppy",
      species_latin_name: "Poecilia reticulata",
      submitted_on: "2026-09-01T00:00:00.000Z",
      points: 10,
      total_points: 20,
      approved_on: null,
      pendingPoints: null,
      statusInfo: { status: "waitingPeriod", label: "Awaiting Auction", icon: "x", color: "", bgColor: "", rowColor: "" },
      ...overrides,
    });

    void test("submissions list: the owner's pending row carries the total, the label and the lines", () => {
      const html = memberPage([row({ pendingPoints: pending })]);

      assert.match(html, /class="pending-points-total">20 pts</);
      assert.match(html, /pending approval/);
      assert.match(html, /Base points 10 \+ Article Bonus 5 \+ CARES Species Bonus 5/);
      assert.match(html, /data-sort="20"/, "sorts as its number, not as its words");
      assert.doesNotMatch(html, /Unapproved/);
    });

    void test("submissions list: an unapproved row with no pending local is unapproved, whatever its columns hold", () => {
      const html = memberPage([row({})]);

      assert.match(html, /Unapproved/);
      assert.doesNotMatch(html, /pending approval|pending-points-total/);
      assert.doesNotMatch(html, /data-sort="20"/);
    });

    void test("submissions list: an approved row shows its awarded points as before", () => {
      const html = memberPage([row({ approved_on: "2026-10-20T00:00:00.000Z", statusInfo: { status: "approved", label: "Approved", icon: "x", color: "", bgColor: "", rowColor: "" } })], 20);

      assert.match(html, /data-sort="20">20</);
      assert.doesNotMatch(html, /pending approval|Unapproved/);
    });
  });

  void describe("Pages that pointed nowhere", () => {
    const render = (view: string, data: Record<string, unknown>) =>
      pug.compileFile(path.join(viewsPath, view), { basedir: viewsPath, pretty: false })({ ...baseMockData, ...data });

    void test("the error page shows its message", () => {
      const html = render("error.pug", { title: "Species Not Found", message: "Species not found" });

      assert.match(html, /Species not found/);
    });

    void test("the landing page has no pasted tagline", () => {
      assert.doesNotMatch(render("index.pug", {}), /Insights, tutorials/);
    });

    void test("the CARES page sends a member to their own collection", () => {
      const html = render("cares.pug", {
        stats: { speciesCount: 42, memberCount: 12 },
        isParticipant: false,
        memberSpeciesCount: 0,
        viewerId: 42,
      });

      assert.match(html, /href="\/member\/42\/collection"/);
      assert.doesNotMatch(html, /\/collection\/new/);
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
