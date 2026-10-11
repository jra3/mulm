import { describe, test } from "node:test";
import assert from "node:assert";
import * as pug from "pug";
import { witnessLetter, type WitnessedSubmission } from "../notifications";
import { totalPoints } from "../points";

/**
 * The witness email (#526): one letter when the Witness is confirmed, carrying
 * the full points breakdown while there is still time to dispute it. These
 * tests pin the letter's facts (`witnessLetter`) and the template that prints
 * them, across the four Species types.
 */

const renderWitnessed = pug.compileFile("src/views/email/onWitnessConfirmed.pug");

const witness = { display_name: "Marcus Lee" };
const member = { display_name: "Dana Ruiz" };

/** A BAP fish: CARES and article bonuses on base 10, witnessed 2026-10-09. */
const fish: WitnessedSubmission = {
  id: 321,
  species_type: "Fish",
  species_class: "Livebearers",
  species_common_name: "Butterfly Goodeid",
  species_latin_name: "Ameca splendens",
  reproduction_date: "2026-09-20T00:00:00.000Z",
  witnessed_on: "2026-10-09T14:00:00.000Z",
  points: 10,
  article_points: 5,
  cares_species: true,
  flowered: false,
  sexual_reproduction: false,
};

const invert: WitnessedSubmission = {
  ...fish,
  id: 322,
  species_type: "Invert",
  species_class: "Shrimp",
  species_common_name: "Cherry Shrimp",
  species_latin_name: "Neocaridina davidi",
  article_points: null,
  cares_species: false,
};

/** A HAP plant that has flowered, species brought in before. */
const plant: WitnessedSubmission = {
  id: 323,
  species_type: "Plant",
  species_class: "Cryptocoryne",
  species_common_name: "Wendt's Water Trumpet",
  species_latin_name: "Cryptocoryne wendtii",
  reproduction_date: "2026-08-30T00:00:00.000Z",
  witnessed_on: "2026-10-09T14:00:00.000Z",
  points: 10,
  article_points: null,
  cares_species: false,
  flowered: true,
  sexual_reproduction: false,
};

const coral: WitnessedSubmission = {
  id: 324,
  species_type: "Coral",
  species_class: "SPS",
  species_common_name: "Green Birdsnest",
  species_latin_name: "Seriatopora hystrix",
  reproduction_date: "2026-07-01T00:00:00.000Z",
  witnessed_on: "2026-10-09T14:00:00.000Z",
  points: 15,
  article_points: 10,
  cares_species: false,
  flowered: false,
  sexual_reproduction: false,
};

const variants = { fish, invert, plant, coral };

function render(submission: WitnessedSubmission, firstTime = false) {
  return renderWitnessed({
    domain: "bap.basny.org",
    member,
    letter: witnessLetter(submission, witness, { firstTime }),
  });
}

void describe("The witness email's facts", () => {
  void test("the subject names the Species and the total pending approval", () => {
    assert.strictEqual(
      witnessLetter(fish, witness, { firstTime: true }).subject,
      "Witnessed: Butterfly Goodeid, 20 points pending approval"
    );
    assert.strictEqual(
      witnessLetter(plant, witness, { firstTime: false }).subject,
      "Witnessed: Wendt's Water Trumpet, 20 points pending approval"
    );
  });

  void test("fish and inverts spawned; plants and corals propagated", () => {
    for (const s of [fish, invert]) {
      const letter = witnessLetter(s, witness, { firstTime: false });
      assert.strictEqual(letter.heading, "Your spawn has been witnessed");
      assert.strictEqual(letter.reproductionLabel, "Reproduced");
    }
    for (const s of [plant, coral]) {
      const letter = witnessLetter(s, witness, { firstTime: false });
      assert.strictEqual(letter.heading, "Your propagation has been witnessed");
      assert.strictEqual(letter.reproductionLabel, "Propagated");
    }
  });

  void test("the Program is named the way members know it", () => {
    assert.strictEqual(witnessLetter(fish, witness, { firstTime: false }).programAbbreviation, "BAP");
    assert.strictEqual(witnessLetter(invert, witness, { firstTime: false }).programAbbreviation, "BAP");
    assert.strictEqual(witnessLetter(plant, witness, { firstTime: false }).programAbbreviation, "HAP");
    assert.strictEqual(witnessLetter(coral, witness, { firstTime: false }).programAbbreviation, "CAP");
    assert.strictEqual(witnessLetter(plant, witness, { firstTime: false }).programName, "Horticultural Awards Program");
  });

  void test("the points lines add up to the total, base points first", () => {
    for (const [name, submission] of Object.entries(variants)) {
      const letter = witnessLetter(submission, witness, { firstTime: true });
      assert.strictEqual(letter.lines[0].label, "Base points", name);
      assert.strictEqual(letter.lines[0].amount, submission.points, name);
      const sum = letter.lines.reduce((acc, line) => acc + line.amount, 0);
      assert.strictEqual(sum, letter.total, name);
      assert.strictEqual(letter.total, totalPoints(submission), name);
    }
    assert.deepStrictEqual(
      witnessLetter(fish, witness, { firstTime: true }).lines.map((l) => l.label),
      ["Base points", "Article Bonus", "CARES Species Bonus"]
    );
  });

  void test("first-time is never added to the total", () => {
    const first = witnessLetter(fish, witness, { firstTime: true });
    const again = witnessLetter(fish, witness, { firstTime: false });
    assert.strictEqual(first.total, again.total);
    assert.strictEqual(first.firstTime, true);
    assert.strictEqual(again.firstTime, false);
    assert.ok(!first.lines.some((l) => /first/i.test(l.label)));
  });

  void test("the bonuses still possible are named, and only those", () => {
    const line = (s: WitnessedSubmission) => witnessLetter(s, witness, { firstTime: false }).laterBonuses;
    // Article already counted on BAP: nothing is left to add
    assert.strictEqual(line(fish), null);
    // No article yet on BAP: the article is the one thing left
    assert.strictEqual(line(invert), "Write an article after approval? Tell the committee and they'll add the bonus.");
    // Flowered already: the article and sexual reproduction remain
    assert.strictEqual(
      line(plant),
      "Write an article, or see sexual reproduction, after approval? Tell the committee and they'll add the bonus."
    );
    // Nothing set yet on HAP
    assert.strictEqual(
      line({ ...plant, flowered: false }),
      "Write an article, or see flowering or sexual reproduction, after approval? Tell the committee and they'll add the bonus."
    );
    // Article in, nothing flowered: no article clause
    assert.strictEqual(
      line({ ...plant, flowered: false, article_points: 5 }),
      "See flowering or sexual reproduction after approval? Tell the committee and they'll add the bonus."
    );
    // Everything a HAP row can carry is on it
    assert.strictEqual(line({ ...plant, article_points: 10, sexual_reproduction: true }), null);
    // Coral with the article counted
    assert.strictEqual(line(coral), null);
  });

  void test("the waiting period's end is the reproduction day plus the clock, and fish keep fry until then", () => {
    const fishLetter = witnessLetter(fish, witness, { firstTime: false });
    assert.strictEqual(fishLetter.readyOn, "November 19, 2026");
    assert.strictEqual(fishLetter.keepFry, true);
    assert.strictEqual(fishLetter.offspring, "fry");

    const marine = witnessLetter({ ...fish, species_class: "Marine" }, witness, { firstTime: false });
    assert.strictEqual(marine.readyOn, "October 20, 2026");

    const plantLetter = witnessLetter(plant, witness, { firstTime: false });
    assert.strictEqual(plantLetter.readyOn, "October 29, 2026");
    assert.strictEqual(plantLetter.keepFry, false);
    assert.strictEqual(plantLetter.offspring, "plants");

    assert.strictEqual(witnessLetter(invert, witness, { firstTime: false }).keepFry, false);
    assert.strictEqual(witnessLetter(coral, witness, { firstTime: false }).offspring, "corals");
  });

  void test("the witness and the days are printed as long dates in UTC", () => {
    const letter = witnessLetter(fish, witness, { firstTime: false });
    assert.strictEqual(letter.witnessName, "Marcus Lee");
    assert.strictEqual(letter.witnessedOn, "October 9, 2026");
    assert.strictEqual(letter.reproducedOn, "September 20, 2026");
  });
});

void describe("The witness email renders", () => {
  void test("every Species type renders with its heading, Program and points", () => {
    const expectations = {
      fish: { heading: "Your spawn has been witnessed", program: "BAP", bring: "Bring the fry" },
      invert: { heading: "Your spawn has been witnessed", program: "BAP", bring: "Bring the fry" },
      plant: { heading: "Your propagation has been witnessed", program: "HAP", bring: "Bring the plants" },
      coral: { heading: "Your propagation has been witnessed", program: "CAP", bring: "Bring the corals" },
    };
    for (const [name, submission] of Object.entries(variants)) {
      const html = render(submission);
      const expected = expectations[name as keyof typeof expectations];
      assert.match(html, new RegExp(`<h1>${expected.heading}</h1>`), name);
      assert.ok(
        html.includes(`Marcus Lee witnessed your ${expected.program} submission on October 9, 2026 and set its points.`),
        name
      );
      assert.ok(html.includes("The points count once the committee approves the submission at a meeting."), name);
      assert.ok(html.includes(expected.bring), name);
      assert.ok(html.includes("Hello Dana Ruiz"), name);
      assert.ok(html.includes(submission.species_common_name), name);
      assert.ok(html.includes(submission.species_latin_name), name);
      assert.ok(html.includes(submission.species_class), name);
      assert.ok(html.includes(`https://bap.basny.org/submissions/${submission.id}`), name);
      assert.ok(!html.includes("Brought to Meeting"), name);
    }
  });

  void test("the points table itemises what is set and marks the total pending approval", () => {
    const html = render(fish);
    assert.match(html, /<td>Base points<\/td><td class="n">10<\/td>/);
    assert.match(html, /<td>Article Bonus<\/td><td class="n">\+5<\/td>/);
    assert.match(html, /<td>CARES Species Bonus<\/td><td class="n">\+5<\/td>/);
    assert.match(html, /id="witness-total"[^>]*>Total <span class="pending">pending approval<\/span><\/td><td class="n">20<\/td>/);
    assert.doesNotMatch(html, /Flowering Bonus|Sexual Reproduction Bonus|First Time Species Bonus/);

    const plantHtml = render(plant);
    assert.match(plantHtml, /<td>Flowering Bonus<\/td><td class="n">\+10<\/td>/);
    assert.doesNotMatch(plantHtml, /CARES/);
  });

  void test("the first-time line appears only when the Species has no approved Submission", () => {
    const first = render(fish, true);
    assert.ok(first.includes('id="witness-first-time"'));
    assert.ok(first.includes("If you're the first member to bring this species in, you'll earn a 5-point first-time bonus at the meeting."));
    // and it is not in the table
    assert.match(first, /id="witness-total"[^>]*>Total <span class="pending">pending approval<\/span><\/td><td class="n">20<\/td>/);

    const again = render(fish, false);
    assert.ok(!again.includes('id="witness-first-time"'));
    assert.ok(!again.includes("first-time bonus"));
  });

  void test("the bonuses-still-possible line appears only when some bonus is", () => {
    assert.ok(!render(fish).includes('id="witness-later-bonuses"'));
    const plantHtml = render(plant);
    assert.ok(plantHtml.includes('id="witness-later-bonuses"'));
    assert.ok(
      plantHtml.includes(
        "Write an article, or see sexual reproduction, after approval? Tell the committee and they'll add the bonus."
      )
    );
  });

  void test("next steps name the waiting period's end, the reminder, the meeting and the approval", () => {
    const fishHtml = render(fish);
    assert.ok(fishHtml.includes("Keep at least 6 healthy fry until your waiting period ends on <b>November 19, 2026</b>."));
    assert.ok(fishHtml.includes("We'll send a reminder that day."));
    assert.ok(fishHtml.includes("Bring the fry to a monthly meeting."));
    assert.ok(fishHtml.includes("A committee member approves it there and the points are awarded."));

    const plantHtml = render(plant);
    assert.ok(plantHtml.includes("Your waiting period ends on <b>October 29, 2026</b>."));
    assert.ok(!plantHtml.includes("healthy fry"));
  });

  void test("something wrong? says how to dispute the points and what an edit does", () => {
    const html = render(fish);
    assert.ok(html.includes("Points look wrong?"));
    assert.ok(html.includes("Reply to this email. Your reply goes to the committee."));
    assert.ok(html.includes("Details wrong, or an article or video to add?"));
    assert.ok(
      html.includes(
        "Edit your submission. Any edit sends it back to be witnessed again, and you'll get a new email with the new points."
      )
    );
  });

  void test("the sign-off thanks the member for the right Program", () => {
    assert.ok(render(fish).includes("Thank you for participating in the Breeders Awards Program!"));
    assert.ok(render(plant).includes("Thank you for participating in the Horticultural Awards Program!"));
    assert.ok(render(coral).includes("Thank you for participating in the Coral Awards Program!"));
  });
});
