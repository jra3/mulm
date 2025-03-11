import { getWriteDBConnecton, query } from "./conn";

type Submission = {
    id: number;
    submission_date: string;
    member_name: string;
    species_name: string;

    date_approved?: string;
    approved_by?: string;
    points?: number;
};

export function addSubmission(memberName: string, speciesName: string) {
    try {
        const conn = getWriteDBConnecton();
        const stmt = conn.prepare("INSERT INTO submissions (member_name, species_name) VALUES (?, ?)");
        stmt.run(memberName, speciesName);
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
    return query<Submission>("SELECT * FROM submissions WHERE date_approved IS NULL");
}

export function getAllSubmissions() {
    return query<Submission>("SELECT * FROM submissions");
}

//console.log(getOutstandingSubmissions())
