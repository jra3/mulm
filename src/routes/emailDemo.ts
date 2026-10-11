import { Response } from "express";
import { MulmRequest } from "../sessions";
import { bonusBreakdown, totalPoints } from "../points";
import { rewitnessLetterRows, witnessLetter, type WitnessedSubmission } from "../notifications";

/**
 * Demo route to preview all email templates
 * Only accessible in development or to admins
 */
export const emailDemoPage = (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  // Only allow in development or for admins
  if (process.env.NODE_ENV === "production" && !viewer?.is_admin) {
    res.status(404).send("Not found");
    return;
  }

  // A first-time CARES fish that also earned article points, so the approval
  // email's bonus breakdown shows every bonus a BAP submission may carry.
  const sampleSubmission = {
    id: 123,
    species_common_name: "Endler Guppy",
    species_latin_name: "Poecilia wingei",
    species_class: "Livebearers",
    species_type: "Fish",
    reproduction_date: "2024-09-15T00:00:00.000Z",
    submitted_on: "2024-10-01T14:30:00.000Z",
    witnessed_on: "2024-10-02T10:15:00.000Z",
    approved_on: "2024-11-16T09:00:00.000Z",
    points: 15,
    article_points: 5,
    first_time_species: true,
    cares_species: true,
    flowered: false,
    sexual_reproduction: false,
    witness_verification_status: "confirmed" as const,
  };

  // The witness email (#526), one per Species type: a first-time CARES fish
  // with an article, an invert with nothing but base points, a plant that has
  // flowered and been brought in before, and a coral with the article in
  const witnessedOn = "2026-10-09T19:00:00.000Z";
  const witnessedBase = {
    witnessed_on: witnessedOn,
    article_points: null,
    cares_species: false,
    flowered: false,
    sexual_reproduction: false,
  };
  const witnessedSubmissions: { submission: WitnessedSubmission; firstTime: boolean }[] = [
    {
      submission: {
        ...witnessedBase,
        id: 131,
        species_type: "Fish",
        species_class: "Livebearers",
        species_common_name: "Butterfly Goodeid",
        species_latin_name: "Ameca splendens",
        reproduction_date: "2026-09-20T00:00:00.000Z",
        points: 10,
        article_points: 5,
        cares_species: true,
      },
      firstTime: true,
    },
    {
      submission: {
        ...witnessedBase,
        id: 132,
        species_type: "Invert",
        species_class: "Shrimp",
        species_common_name: "Cherry Shrimp",
        species_latin_name: "Neocaridina davidi",
        reproduction_date: "2026-09-01T00:00:00.000Z",
        points: 5,
      },
      firstTime: false,
    },
    {
      submission: {
        ...witnessedBase,
        id: 133,
        species_type: "Plant",
        species_class: "Cryptocoryne",
        species_common_name: "Wendt's Water Trumpet",
        species_latin_name: "Cryptocoryne wendtii",
        reproduction_date: "2026-08-30T00:00:00.000Z",
        points: 10,
        flowered: true,
      },
      firstTime: false,
    },
    {
      submission: {
        ...witnessedBase,
        id: 134,
        species_type: "Coral",
        species_class: "SPS",
        species_common_name: "Green Birdsnest",
        species_latin_name: "Seriatopora hystrix",
        reproduction_date: "2026-07-01T00:00:00.000Z",
        points: 15,
        article_points: 10,
      },
      firstTime: true,
    },
  ];
  const witnessName = { display_name: "Marcus Lee" };

  // Sample data for all email types
  const sampleData = {
    // Common data
    domain: "bap.basny.org",
    programContactEmail: "bap@basny.org", // Sample email for demo

    // Member data
    member: {
      display_name: "Jane Aquarist",
      contact_email: "jane@example.com",
      id: 1,
      fish_level: "Level 2 Breeder Award",
      plant_level: null,
      coral_level: null,
    },

    // Witness data
    witness: {
      display_name: "Admin Witness",
      contact_email: "admin@basny.org",
      id: 2,
    },

    // Submission data, with the total taken from the Points rule so the preview
    // cannot disagree with the breakdown beneath it
    submission: { ...sampleSubmission, total_points: totalPoints(sampleSubmission) },

    // What the waiting-period reminder says the member brings
    offspring: "fry",

    // The witness emails, their facts worked out the way the real letter's are
    witnessLetters: witnessedSubmissions.map(({ submission, firstTime }) =>
      witnessLetter(submission, witnessName, { firstTime })
    ),

    // The re-witness letter (#524): the member's Submissions migration 066
    // sent back for a Witness, one in its waiting period and one past it
    submissions: rewitnessLetterRows([
      {
        id: 124,
        species_common_name: "Cherry Barb",
        species_latin_name: "Puntius titteya",
        species_type: "Fish",
        species_class: "Cyprinids",
        reproduction_date: "2026-08-20T00:00:00.000Z",
        originalWitness: { name: "Pat Rivera", date: "2026-08-28" },
        readyOn: "2026-10-19",
        waitingPeriodOver: false,
      },
      {
        id: 125,
        species_common_name: "Java Fern",
        species_latin_name: "Microsorum pteropus",
        species_type: "Plant",
        species_class: "Ferns",
        reproduction_date: "2026-06-01T00:00:00.000Z",
        originalWitness: { name: "Pat Rivera", date: "2026-06-10" },
        readyOn: "2026-07-31",
        waitingPeriodOver: true,
      },
    ]),

    // Auth code for password reset
    code: "demo_reset_code_12345678",

    // Reason for witness decline
    reason:
      "Please provide clearer photos of the fry. The current images are too blurry to confirm the spawn.",

    // Invitation data
    fishSubmissions: [
      {
        species_common_name: "Cherry Barb",
        species_latin_name: "Puntius titteya",
        reproduction_date: "2024-08-20T00:00:00.000Z",
        points: 10,
        total_points: 10,
      },
    ],
    plantSubmissions: [],
    coralSubmissions: [],
    fishTotal: 10,
    plantTotal: 0,
    coralTotal: 0,

    // New award info
    award: {
      award_name: "Level 2 Breeder Award",
      date_awarded: "2024-11-16T09:00:00.000Z",
    },

    // A Specialty Award, which now announces itself by email as well as in the feed
    awardName: "Anabantoid Specialist Award",

    // The committee's daily digest of what is still waiting on them
    digest: {
      total: 3,
      sections: [
        {
          program: "fish",
          programName: "Breeder Awards Program",
          queue: "witness",
          title: "Waiting to be screened",
          submissions: [
            {
              id: 401,
              memberName: "Jane Aquarist",
              speciesCommonName: "Endler Guppy",
              speciesLatinName: "Poecilia wingei",
              waitingSince: "2024-10-01T14:30:00.000Z",
            },
            {
              id: 402,
              memberName: "Sam Keeper",
              speciesCommonName: "Cherry Barb",
              speciesLatinName: "Puntius titteya",
              waitingSince: "2024-10-03T09:12:00.000Z",
            },
          ],
        },
        {
          program: "plant",
          programName: "Horticultural Awards Program",
          queue: "approval",
          title: "Ready for points",
          submissions: [
            {
              id: 403,
              memberName: "Alex Grower",
              speciesCommonName: "Java Fern",
              speciesLatinName: "Microsorum pteropus",
              waitingSince: "2024-08-11T18:00:00.000Z",
            },
          ],
        },
      ],
    },
  };

  res.render("demo/emails", {
    title: "Email Templates Demo",
    sampleData,
    // Spread sample data for email templates to access
    ...sampleData,
    bonusLines: bonusBreakdown(sampleSubmission),
  });
};
