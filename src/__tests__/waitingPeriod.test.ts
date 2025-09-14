import { getRequiredWaitingDays } from '../utils/waitingPeriod';

describe('getRequiredWaitingDays', () => {
  it('returns 30 days for marine fish', () => {
    const marineSubmission = {
      species_type: 'Fish',
      species_class: 'Marine'
    };
    expect(getRequiredWaitingDays(marineSubmission)).toBe(30);
  });

  it('returns 60 days for freshwater fish', () => {
    const freshwaterSubmission = {
      species_type: 'Fish',
      species_class: 'New World'
    };
    expect(getRequiredWaitingDays(freshwaterSubmission)).toBe(60);
  });

  it('returns 60 days for plants', () => {
    const plantSubmission = {
      species_type: 'Plant',
      species_class: 'Anubius'
    };
    expect(getRequiredWaitingDays(plantSubmission)).toBe(60);
  });

  it('returns 60 days for corals', () => {
    const coralSubmission = {
      species_type: 'Coral',
      species_class: 'SPS'
    };
    expect(getRequiredWaitingDays(coralSubmission)).toBe(60);
  });

  it('returns 60 days for inverts', () => {
    const invertSubmission = {
      species_type: 'Invert',
      species_class: 'Shrimp'
    };
    expect(getRequiredWaitingDays(invertSubmission)).toBe(60);
  });
});