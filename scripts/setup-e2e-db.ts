#!/usr/bin/env ts-node
/**
 * Setup script for E2E tests
 * Creates and migrates the test database before running Playwright tests
 */

import { open } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

async function setupE2EDatabase() {
	const dbPath = path.join(__dirname, "../db/database.db");

	console.log("Setting up E2E test database...");
	console.log(`Database path: ${dbPath}`);

	// Ensure db directory exists
	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		console.log(`Creating db directory: ${dbDir}`);
		fs.mkdirSync(dbDir, { recursive: true });
	}

	// Open/create database
	const db = await open({
		filename: dbPath,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
	});

	// Run migrations
	console.log("Running migrations...");
	await db.migrate({
		migrationsPath: path.join(__dirname, "../db/migrations"),
	});

	console.log("Migrations complete");

	// Close the connection
	await db.close();

	console.log("E2E database setup complete ✓");
}

setupE2EDatabase().catch((error) => {
	console.error("Failed to setup E2E database:", error);
	process.exit(1);
});
