import { FormValues } from "../submissionSchema";
import { getWriteDBConnecton, query } from "./conn";

export type Submission = {
    id: number;
    submission_date: string;
    member_name: string;
    species_name: string;

    date_approved?: string;
    approved_by?: string;
    points?: number;
};

export function addSubmission(form: FormValues, submit: boolean) {
    try {
        const conn = getWriteDBConnecton();
        const stmt = conn.prepare(`
            INSERT INTO submissions
            (
                member_name,
                species_type,
                species_class,
                species_common_name,
                species_latin_name,
                water_type,
                count,

                tank_size,
                filter_type,
                water_change_volume,
                water_change_frequency,
                temperature,
                pH,
                GH,
                specific_gravity,
                substrate_type,
                substrate_depth,
                substrate_color,

                submitted_on)
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        console.log(form);
        stmt.run(
            form.memberName,
            form.speciesType,
            form.speciesClass,
            form.speciesCommonName,
            form.speciesLatinName,
            form.waterType,
            form.count,
            form.tankSize,
            form.filterType,

            form.changeVolume,
            form.changeFrequency,
            form.temperature,
            form.pH,
            form.GH,
            form.specificGravity,
            form.substrateType,
            form.substrateDepth,
            form.substrateColor,

            submit ? new Date().toISOString() : null,
        );
        conn.close();
    } catch (err) {
        console.error(err);
        throw new Error("Failed to add submission");
    }
}

export function getSubmissionsByMember(memberName: string) {
    return query<Submission>("SELECT * FROM submissions WHERE member_name = ?", [memberName]);
}

export function getSubmissionsInDateRange(startDate: Date, endDate: Date) {
    return query<Submission>(
        "SELECT * FROM submissions WHERE submission_date > ? AND submission_date < ?",
        [
            startDate.toISOString(),
            endDate.toISOString(),
        ],
    );
}

export function getOutstandingSubmissions() {
    return query<Submission>(`
        SELECT * FROM submissions
        WHERE submitted_on IS NOT NULL
        AND approved_on IS NULL
    `);
}

export function getAllSubmissions() {
    return query<Submission>("SELECT * FROM submissions");
}

export function approveSubmission(id: number, points: number, approvedBy: string) {
    try {
        const conn = getWriteDBConnecton();
        const stmt = conn.prepare(`UPDATE submissions SET points = ?, approved_by = ?, date_approved = ? WHERE id = ?`);
        stmt.run(points, approvedBy, new Date().toISOString(), id);
        conn.close();
    } catch (err) {
        console.error(err);
        throw new Error("Failed to update submission");
    }
}

