/**
 * Database table type definitions
 * These types mirror the actual database schema
 */

// Sessions table
export type Session = {
	session_id: string;
	member_id: number;
	expires_on: string;
};

// Google Account table
export type GoogleAccount = {
	google_sub: string;
	google_email: string | null;
	member_id: number;
};

// Password Account table
export type PasswordAccount = {
	member_id: number;
	N: number;
	r: number;
	p: number;
	salt: string;
	hash: string;
};

// Species Name table
export type SpeciesName = {
	name_id: number;
	group_id: number;
	common_name: string;
	scientific_name: string;
};

// Species Name Group table
export type SpeciesNameGroup = {
	group_id: number;
	program_class: string;
	canonical_genus: string;
	canonical_species_name: string;
};