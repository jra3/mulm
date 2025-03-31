import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createMember, getMembersList } from "../db/members";
import { setDBFactory } from "../db/conn";

beforeAll(() => {
	fs.mkdirSync("/tmp/mulm");
});

let instance = 1;
beforeEach(() => {
	const dbUri = `/tmp/mulm/database-${instance++}.sqlite`;
	const memoryDb = new Database(dbUri);
	const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), 'utf-8')
	memoryDb.exec(schema);
	setDBFactory((readonly) => new Database(dbUri, { readonly }));
	memoryDb.close();
	// Seed data
});

afterAll(() => {
	fs.rmdirSync("/tmp/mulm", { recursive: true });
});

test('Members list append', () => {
	expect(getMembersList().length).toEqual(0);
	createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
	expect(getMembersList().length).toEqual(1);
})

/* test('Members list append', () => {
	createMember("honk@dazzle2.com", "Honk Dazzle", { google_sub: "123456789" });
	expect(getMembersList().length).toEqual(1);
})
 */
