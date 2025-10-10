import { Response } from 'express';
import { MulmRequest } from '../sessions';

/**
 * Demo route to preview all email templates
 * Only accessible in development or to admins
 */
export const emailDemoPage = (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  // Only allow in development or for admins
  if (process.env.NODE_ENV === 'production' && !viewer?.is_admin) {
    res.status(404).send('Not found');
    return;
  }

  // Sample data for all email types
  const sampleData = {
    // Common data
    domain: 'bap.basny.org',
    programContactEmail: 'bap@basny.org', // Sample email for demo

    // Member data
    member: {
      display_name: 'Jane Aquarist',
      contact_email: 'jane@example.com',
      id: 1,
      fish_level: 'Level 2 Breeder Award',
      plant_level: null,
      coral_level: null
    },

    // Witness data
    witness: {
      display_name: 'Admin Witness',
      contact_email: 'admin@basny.org',
      id: 2
    },

    // Submission data
    submission: {
      id: 123,
      species_common_name: 'Endler Guppy',
      species_latin_name: 'Poecilia wingei',
      species_class: 'Livebearers',
      species_type: 'Fish',
      reproduction_date: '2024-09-15T00:00:00.000Z',
      submitted_on: '2024-10-01T14:30:00.000Z',
      witnessed_on: '2024-10-02T10:15:00.000Z',
      approved_on: '2024-11-16T09:00:00.000Z',
      points: 15,
      article_points: 5,
      first_time_species: true,
      flowered: false,
      sexual_reproduction: false,
      total_points: 25,
      witness_verification_status: 'confirmed' as const
    },

    // Auth code for password reset
    code: 'demo_reset_code_12345678',

    // Reason for witness decline
    reason: 'Please provide clearer photos of the fry. The current images are too blurry to confirm the spawn.',

    // Invitation data
    fishSubmissions: [
      {
        species_common_name: 'Cherry Barb',
        species_latin_name: 'Puntius titteya',
        reproduction_date: '2024-08-20T00:00:00.000Z',
        points: 10,
        total_points: 10
      }
    ],
    plantSubmissions: [],
    coralSubmissions: [],
    fishTotal: 10,
    plantTotal: 0,
    coralTotal: 0,

    // New award info
    award: {
      award_name: 'Level 2 Breeder Award',
      date_awarded: '2024-11-16T09:00:00.000Z'
    }
  };

  res.render('demo/emails', {
    title: 'Email Templates Demo',
    sampleData,
    // Spread sample data for email templates to access
    ...sampleData
  });
};
