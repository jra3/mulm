import { Response } from "express";
import { MulmRequest } from "@/sessions";

export const view = (req: MulmRequest, res: Response) => {
  // Sample activities matching the ActivityFeedItem interface
  const sampleActivities = [
    {
      id: 1,
      activity_type: "submission_approved" as const,
      member_id: 1,
      member_name: "Don Lang",
      related_id: "42",
      activity_data: JSON.stringify({
        species_common_name: "Cherry Barb",
        species_type: "Fish",
        points: 10,
        first_time_species: true,
        article_points: 5,
      }),
      created_at: new Date().toISOString(),
      awards: [
        {
          member_id: 1,
          award_name: "Master Breeder",
          date_awarded: "2024-01-15",
          award_type: "species" as const,
        },
      ],
    },
    {
      id: 2,
      activity_type: "submission_approved" as const,
      member_id: 2,
      member_name: "Jane Smith",
      related_id: "43",
      activity_data: JSON.stringify({
        species_common_name: "Congo Tetra",
        species_type: "Fish",
        points: 20,
        first_time_species: false,
      }),
      created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      awards: [],
    },
    {
      id: 3,
      activity_type: "award_granted" as const,
      member_id: 3,
      member_name: "Bob Johnson",
      related_id: "",
      activity_data: JSON.stringify({
        award_name: "Cichlid Specialist",
        award_type: "specialty",
      }),
      created_at: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
      awards: [
        {
          member_id: 3,
          award_name: "Cichlid Specialist",
          date_awarded: "2024-10-15",
          award_type: "species" as const,
        },
        {
          member_id: 3,
          award_name: "Expert Breeder",
          date_awarded: "2024-08-01",
          award_type: "meta_species" as const,
        },
      ],
    },
    {
      id: 4,
      activity_type: "award_granted" as const,
      member_id: 1,
      member_name: "Don Lang",
      related_id: "",
      activity_data: JSON.stringify({
        award_name: "Grand Master",
        award_type: "meta",
      }),
      created_at: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
      awards: [
        {
          member_id: 1,
          award_name: "Master Breeder",
          date_awarded: "2024-01-15",
          award_type: "species" as const,
        },
      ],
    },
    {
      id: 5,
      activity_type: "submission_approved" as const,
      member_id: 4,
      member_name: "Alice Williams",
      related_id: "44",
      activity_data: JSON.stringify({
        species_common_name: "Amazon Sword Plant",
        species_type: "Plant",
        points: 15,
        first_time_species: true,
      }),
      created_at: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
      awards: [],
    },
  ];

  res.render("activityDemo", {
    title: "Activity Feed Demo",
    activities: sampleActivities,
  });
};
