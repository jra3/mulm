/**
 * The Witness and correction form: Species lookup, initial values, available
 * bonuses and the matching summary. Routes supply the request context; Pug
 * renders these decisions. Preparing or refreshing a form never writes.
 * The lifecycle still owns every guard, transactional write and consequence.
 */

import type { Submission } from "@/db/submissions";
import {
  committeeSpeciesChoice,
  getNotesForSubmission,
  type SubmissionNote,
} from "@/db/submission_notes";
import {
  canonicalName as canonicalNameOf,
  checkFormAgreement,
  countSubmissionsOfSpecies,
  findSpeciesById,
  isSpeciesType,
  listNames,
  suggestSpecies,
} from "@/species";
import { originalWitnessFromNotes, type NewSpeciesAtWitness } from "@/lifecycle";
import {
  pointsBreakdown,
  programOfSpeciesType,
  programBonuses,
  type PointsBreakdown,
} from "@/points";
import { isProgramType } from "@/programs";
import { formatShortDate } from "@/utils/dateFormat";
import { chosenSpeciesForm, confirmWitnessSchema, witnessSummaryForm } from "./confirmWitness";
import { correctPointsSchema } from "./correctPoints";

/**
 * What the witness panel and the committee's queue panel show about the Species a
 * Submission is bound to: its Canonical name, a common Name, its
 * classification and the Program it belongs to (which decides the bonuses the
 * witness panel offers, since confirming adopts it), its Point class (which
 * prefills the base points), and the bonuses it implies - first time in the
 * Program for this Species, and CARES. Null when the Submission is unbound,
 * which each panel says in its own way.
 */
export async function boundSpeciesFacts(submission: Pick<Submission, "species_id">) {
  const species = submission.species_id ? await findSpeciesById(submission.species_id) : undefined;
  if (!species) return null;
  // First-time is program-wide: no member has had this Species approved yet
  const [submissionsOfSpecies, names] = await Promise.all([
    countSubmissionsOfSpecies(species.group_id),
    listNames(species.group_id),
  ]);
  return {
    speciesId: species.group_id,
    speciesName: canonicalNameOf(species),
    commonName: names.common[0]?.name ?? null,
    speciesType: species.species_type,
    programClass: species.program_class,
    program: programOfSpeciesType(species.species_type),
    pointClass: species.base_points,
    isFirstTime: submissionsOfSpecies.approved === 0,
    priorBreedCount: submissionsOfSpecies.approved,
    isCaresSpecies: species.is_cares_species === 1,
  };
}

/**
 * The Program a Submission belongs to by its Species type, which is what a
 * Species recorded at the Witness takes (#522); the filed Program stands in
 * for a type the Programs do not know.
 */
export function programOfSubmission(
  submission: Pick<Submission, "species_type" | "program">
): string {
  return isSpeciesType(submission.species_type)
    ? programOfSpeciesType(submission.species_type)
    : submission.program;
}

type PointValues = {
  points: number | null;
  article_points: number | null;
  cares_species: boolean;
  flowered: boolean;
  sexual_reproduction: boolean;
  first_time_species: boolean;
};

type CorrectionFacts = {
  approved: boolean;
  speciesChanged: boolean;
  current: PointValues;
};

type SpeciesPoints = { program: string; pointClass: number | null; isCaresSpecies: boolean };

/** Prepared facts can also be rendered without a catalogue lookup. */
export type WitnessPanelInput = {
  submission: Pick<Submission, "program" | "article_link">;
  speciesFacts: SpeciesPoints | null;
  newSpecies: SpeciesPoints | null;
  speciesChosenByWitness: boolean;
  correction?: CorrectionFacts | null;
};

const CORRECTION_BUTTON = { id: "correction-save", label: "Save correction" };

function offeredBonuses(program: string, approved: boolean) {
  const fields = isProgramType(program) ? programBonuses[program] : [];
  return {
    cares_species: fields.includes("cares_species"),
    flowered: fields.includes("flowered"),
    sexual_reproduction: fields.includes("sexual_reproduction"),
    first_time_species: approved && fields.includes("first_time_species"),
  };
}

/** Omitted controls cannot contribute to either the initial or live sum. */
function visiblePoints(
  values: PointValues,
  offered: ReturnType<typeof offeredBonuses>
): PointValues {
  return {
    ...values,
    cares_species: offered.cares_species && values.cares_species,
    flowered: offered.flowered && values.flowered,
    sexual_reproduction: offered.sexual_reproduction && values.sexual_reproduction,
    first_time_species: offered.first_time_species && values.first_time_species,
  };
}

/**
 * One preparation rule for the controls and their initial summary. Choosing
 * a Species in another Program starts every bonus afresh, even Article and
 * First-time and even when the new Species is CARES-listed. The committee
 * can then explicitly select the bonuses that apply before saving.
 */
export function prepareWitnessPanel(input: WitnessPanelInput) {
  const { submission, speciesFacts, newSpecies, correction } = input;
  const species = newSpecies ?? speciesFacts;
  const program = species?.program ?? submission.program;
  const settled =
    newSpecies != null ||
    (speciesFacts != null && (correction != null || input.speciesChosenByWitness));
  const keepCurrent = correction != null && !correction.speciesChanged;
  const bonusesReset = correction != null && program !== submission.program;
  const offered = offeredBonuses(program, correction?.approved ?? false);
  const current = correction?.current;
  const values = visiblePoints(
    {
      points: keepCurrent ? correction.current.points : (species?.pointClass ?? null),
      article_points: bonusesReset
        ? null
        : current
          ? current.article_points
          : submission.article_link
            ? 5
            : null,
      cares_species:
        !bonusesReset &&
        (keepCurrent ? correction.current.cares_species : (species?.isCaresSpecies ?? false)),
      flowered: !bonusesReset && (current?.flowered ?? false),
      sexual_reproduction: !bonusesReset && (current?.sexual_reproduction ?? false),
      first_time_species: !bonusesReset && (current?.first_time_species ?? false),
    },
    offered
  );
  return {
    pointsForm: { program, settled, keepCurrent, bonusesReset, offered, values },
    summary: witnessSummary({ ...values, bound: species != null, species_settled: settled }),
    summaryButton: correction ? CORRECTION_BUTTON : null,
  };
}

type PanelOptions = {
  notes?: SubmissionNote[];
  newSpecies?: NewSpeciesAtWitness;
} & ({ mode: "witness" } | { mode: "correction"; speciesId?: number });

/** Load once for a full page, a Species selection, or the Record Species step. */
export async function loadWitnessPanel(
  submission: Submission,
  viewerId: number,
  options: PanelOptions
) {
  const correcting = options.mode === "correction";
  const chosenId = options.newSpecies
    ? null
    : correcting
      ? (options.speciesId ?? submission.species_id)
      : submission.species_id;
  const [speciesFacts, agreement, suggested, notes] = await Promise.all([
    boundSpeciesFacts({ species_id: chosenId }),
    chosenId ? checkFormAgreement(chosenId, submission) : undefined,
    suggestSpecies(
      { commonName: submission.species_common_name, latinName: submission.species_latin_name },
      { exclude: chosenId }
    ),
    correcting ? [] : (options.notes ?? getNotesForSubmission(submission.id)),
  ]);
  const choice = committeeSpeciesChoice(notes);
  const original = originalWitnessFromNotes(notes);
  const draft = options.newSpecies;
  const newSpecies = draft
    ? {
        scientificName: `${draft.canonicalGenus} ${draft.canonicalSpeciesName}`,
        commonName: draft.commonName,
        speciesType: submission.species_type,
        programClass: submission.species_class,
        program: programOfSubmission(submission),
        pointClass: draft.pointClass,
        isCaresSpecies: draft.isCaresSpecies,
      }
    : null;
  const correction: CorrectionFacts | null = correcting
    ? {
        approved: submission.approved_on != null,
        speciesChanged:
          newSpecies != null || (chosenId != null && chosenId !== submission.species_id),
        current: {
          points: submission.points,
          article_points: submission.article_points || null,
          cares_species: Boolean(submission.cares_species),
          flowered: Boolean(submission.flowered),
          sexual_reproduction: Boolean(submission.sexual_reproduction),
          first_time_species: Boolean(submission.first_time_species),
        },
      }
    : null;
  const speciesChosenByWitness = correcting || choice != null;
  return {
    speciesFacts,
    newSpecies,
    correction: correction
      ? { approved: correction.approved, speciesChanged: correction.speciesChanged }
      : null,
    speciesChosenByWitness,
    speciesChooser: choice
      ? { name: choice.admin_name, isViewer: choice.admin_id === viewerId }
      : null,
    originalWitness: original
      ? { name: original.name, date: formatShortDate(original.date) }
      : null,
    classificationMismatch: agreement ? !agreement.classificationAgrees : false,
    spellingAgreement:
      !correcting && agreement
        ? { commonName: agreement.commonName, latinName: agreement.latinName }
        : null,
    suggestions: suggested.map((species) => ({
      speciesId: species.group_id,
      commonName: species.common_name,
      speciesName: canonicalNameOf(species),
      speciesType: species.species_type,
      programClass: species.program_class,
      pointClass: species.base_points,
    })),
    ...prepareWitnessPanel({
      submission,
      speciesFacts,
      newSpecies,
      speciesChosenByWitness,
      correction,
    }),
  };
}

/** The selected Species decides the Program for both validation and refresh. */
async function selectedProgram(
  submission: Pick<Submission, "program" | "species_type">,
  speciesId?: number
) {
  const species = speciesId === undefined ? undefined : await findSpeciesById(speciesId);
  return species ? programOfSpeciesType(species.species_type) : programOfSubmission(submission);
}

async function postedProgram(body: unknown, submission: Submission) {
  const chosen = chosenSpeciesForm.safeParse(body);
  return selectedProgram(submission, chosen.success ? chosen.data.species_id : undefined);
}

export async function parseWitnessConfirmation(body: unknown, submission: Submission) {
  return confirmWitnessSchema(await postedProgram(body, submission)).safeParse(body);
}

export async function parsePointsCorrection(body: unknown, submission: Submission) {
  return correctPointsSchema(await postedProgram(body, submission), {
    approved: submission.approved_on != null,
  }).safeParse(body);
}

/**
 * Refresh from the actual posted controls, preserving the committee's new
 * choices after a Program reset. Never reapply initial defaults on refresh.
 */
export async function summarizeWitnessForm(body: unknown, submission: Submission) {
  const parsed = witnessSummaryForm.safeParse(body);
  if (!parsed.success) return parsed;
  const { species_id, new_scientific_name: recording, correction, ...values } = parsed.data;
  const program = await selectedProgram(
    submission,
    recording ? undefined : (species_id ?? submission.species_id ?? undefined)
  );
  const offered = offeredBonuses(program, correction && submission.approved_on != null);
  return {
    success: true as const,
    data: {
      summary: witnessSummary({
        ...visiblePoints(values, offered),
        bound: recording || (species_id ?? submission.species_id) != null,
        species_settled: values.species_settled,
      }),
      summaryButton: correction ? CORRECTION_BUTTON : null,
    },
  };
}

/** The witness panel's sticky bar: ready to confirm, or why not yet. */
type WitnessSummary = PointsBreakdown & {
  ready: boolean;
  /** What is still missing, when not ready. */
  hint: string | null;
};

function witnessSummary(values: {
  bound: boolean;
  species_settled: boolean;
  points: number | null;
  article_points: number | null;
  cares_species: boolean;
  flowered: boolean;
  sexual_reproduction: boolean;
  /** The correction form's switch on an Approved Submission (#528); the Witness never sets it. */
  first_time_species?: boolean;
}): WitnessSummary {
  const notYet = (hint: string): WitnessSummary => ({ ready: false, lines: [], total: 0, hint });
  if (!values.bound) return notYet("Choose the species first");
  if (!values.species_settled) return notYet("Is the species right? Answer above first");
  if (values.points == null) return notYet("Choose the base points");

  return {
    ready: true,
    ...pointsBreakdown({
      points: values.points,
      article_points: values.article_points,
      cares_species: values.cares_species,
      flowered: values.flowered,
      sexual_reproduction: values.sexual_reproduction,
      first_time_species: values.first_time_species ?? false,
    }),
    hint: null,
  };
}
