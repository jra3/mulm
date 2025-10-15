import { calculateLevel, levelRules } from "../programs";

const fishRules = levelRules["fish"];
const plantRules = levelRules["plant"];
const coralRules = levelRules["coral"];

function subs(fives: number, tens: number, fifteens: number, twenties: number): number[] {
  const awards = [];
  for (let i = 0; i < fives; i++) {
    awards.push(5);
  }
  for (let i = 0; i < tens; i++) {
    awards.push(10);
  }
  for (let i = 0; i < fifteens; i++) {
    awards.push(15);
  }
  for (let i = 0; i < twenties; i++) {
    awards.push(20);
  }
  return awards;
}

test("low points", () => {
  expect(calculateLevel(fishRules, subs(4, 0, 0, 0))).toBe("Participant");
  expect(calculateLevel(plantRules, subs(4, 0, 0, 0))).toBe("Participant");
  expect(calculateLevel(coralRules, subs(4, 0, 0, 0))).toBe("Participant");
});

// BAP ladder =============================================

test("hobbyist", () => {
  expect(calculateLevel(fishRules, subs(6, 0, 0, 0))).toBe("Hobbyist");
  expect(calculateLevel(fishRules, subs(500, 0, 0, 0))).toBe("Hobbyist");
  expect(calculateLevel(fishRules, subs(500, 1, 0, 0))).toBe("Hobbyist");
  expect(calculateLevel(fishRules, subs(500, 0, 1, 0))).toBe("Hobbyist");
});

test("breeder", () => {
  expect(calculateLevel(fishRules, subs(0, 5, 0, 0))).toBe("Breeder");
  expect(calculateLevel(fishRules, subs(0, 200, 0, 0))).toBe("Breeder");
});

test("advanced breeder", () => {
  expect(calculateLevel(fishRules, subs(20, 0, 3, 0))).toBe("Advanced Breeder");
  expect(calculateLevel(fishRules, subs(20, 0, 0, 2))).toBe("Advanced Breeder");
});

test("master breeder", () => {
  expect(calculateLevel(fishRules, subs(60, 3, 2, 2))).toBe("Master Breeder");
});

test("master breeder", () => {
  expect(calculateLevel(fishRules, subs(6, 3, 2, 20))).toBe("Master Breeder");
});

test("grand master breeder", () => {
  expect(calculateLevel(fishRules, subs(6, 4, 2, 20))).toBe("Grand Master Breeder");
  expect(calculateLevel(fishRules, subs(600, 4, 2, 2))).toBe("Grand Master Breeder");
});

test("advanced grand master breeder", () => {
  expect(calculateLevel(fishRules, subs(600, 4, 2, 4))).toBe("Advanced Grand Master Breeder");
});

test("senior grand master breeder", () => {
  expect(calculateLevel(fishRules, subs(200, 4, 2, 5))).toBe("Senior Grand Master Breeder");
});

test("premier breeder", () => {
  expect(calculateLevel(fishRules, subs(300, 4, 2, 5))).toBe("Premier Breeder");
});

test("senior premier breeder", () => {
  expect(calculateLevel(fishRules, subs(400, 4, 2, 5))).toBe("Senior Premier Breeder");
});

test("senior premier breeder", () => {
  expect(calculateLevel(fishRules, subs(800, 4, 2, 5))).toBe("Grand Poobah Yoda Breeder");
  expect(calculateLevel(fishRules, subs(9999, 4, 2, 5))).toBe("Grand Poobah Yoda Breeder");
});

// HAP ladder =============================================

test("beginner hort", () => {
  expect(calculateLevel(plantRules, subs(6, 0, 0, 0))).toBe("Beginner Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(500, 0, 0, 0))).toBe("Beginner Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(500, 1, 0, 0))).toBe("Beginner Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(500, 0, 1, 0))).toBe("Beginner Aquatic Horticulturist");
});

test("hort", () => {
  expect(calculateLevel(plantRules, subs(0, 5, 0, 0))).toBe("Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(0, 200, 0, 0))).toBe("Aquatic Horticulturist");
});

test("senior hort", () => {
  expect(calculateLevel(plantRules, subs(12, 0, 0, 2))).toBe("Senior Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(60, 0, 0, 2))).toBe("Senior Aquatic Horticulturist");
});

test("expert hort", () => {
  expect(calculateLevel(plantRules, subs(6, 20, 2, 2))).toBe("Expert Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(6, 39, 2, 2))).toBe("Expert Aquatic Horticulturist");
});

test("master hort", () => {
  expect(calculateLevel(plantRules, subs(6, 40, 2, 2))).toBe("Master Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(6, 400, 2, 2))).toBe("Master Aquatic Horticulturist");
});

test("grand master hort", () => {
  expect(calculateLevel(plantRules, subs(6, 65, 2, 4))).toBe("Grand Master Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(6, 650, 2, 4))).toBe(
    "Grand Master Aquatic Horticulturist"
  );
});

test("senior grand master hort", () => {
  expect(calculateLevel(plantRules, subs(6, 84, 2, 5))).toBe(
    "Senior Grand Master Aquatic Horticulturist"
  );
  expect(calculateLevel(plantRules, subs(6, 129, 2, 7))).toBe(
    "Senior Grand Master Aquatic Horticulturist"
  );
});

test("premier hort", () => {
  expect(calculateLevel(plantRules, subs(6, 130, 2, 7))).toBe("Premier Aquatic Horticulturist");
  expect(calculateLevel(plantRules, subs(6, 179, 2, 7))).toBe("Premier Aquatic Horticulturist");
});

test("senior premier hort", () => {
  expect(calculateLevel(plantRules, subs(6, 180, 2, 7))).toBe(
    "Senior Premier Aquatic Horticulturist"
  );
  expect(calculateLevel(plantRules, subs(6, 9999, 2, 7))).toBe(
    "Senior Premier Aquatic Horticulturist"
  );
});

// CAP ladder =============================================

test("beginner prop", () => {
  expect(calculateLevel(coralRules, subs(5, 0, 0, 0))).toBe("Beginner Coral Propagator");
  expect(calculateLevel(coralRules, subs(9, 0, 0, 0))).toBe("Beginner Coral Propagator");
});

test("prop", () => {
  expect(calculateLevel(coralRules, subs(0, 5, 0, 0))).toBe("Coral Propagator");
  expect(calculateLevel(coralRules, subs(1, 9, 0, 0))).toBe("Coral Propagator");
});

test("senior prop", () => {
  expect(calculateLevel(coralRules, subs(0, 10, 0, 0))).toBe("Senior Coral Propagator");
  expect(calculateLevel(coralRules, subs(1, 29, 0, 0))).toBe("Senior Coral Propagator");
});

test("expert prop", () => {
  expect(calculateLevel(coralRules, subs(0, 30, 0, 0))).toBe("Expert Coral Propagator");
  expect(calculateLevel(coralRules, subs(1, 49, 0, 0))).toBe("Expert Coral Propagator");
});

test("master prop", () => {
  expect(calculateLevel(coralRules, subs(0, 50, 0, 0))).toBe("Master Coral Propagator");
  expect(calculateLevel(coralRules, subs(1, 74, 0, 0))).toBe("Master Coral Propagator");
});

test("grand master prop", () => {
  expect(calculateLevel(coralRules, subs(0, 75, 0, 0))).toBe("Grand Master Coral Propagator");
  expect(calculateLevel(coralRules, subs(1, 99, 0, 0))).toBe("Grand Master Coral Propagator");
});

test("senior grand master prop", () => {
  expect(calculateLevel(coralRules, subs(0, 100, 0, 0))).toBe(
    "Senior Grand Master Coral Propagator"
  );
  expect(calculateLevel(coralRules, subs(0, 0, 0, 9999))).toBe(
    "Senior Grand Master Coral Propagator"
  );
});
