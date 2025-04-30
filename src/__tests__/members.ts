import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createMember, getGoogleAccount, getMember, getMemberByEmail, getMembersList } from "../db/members";
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
	createMember("honk@dazzle.com", "Honk Dazzle");
	expect(getMembersList().length).toEqual(1);
})

test('Create and fetch', async () => {
	const id = await createMember("honk@dazzle.com", "Honk Dazzle");
	expect(getMemberByEmail("honk@dazzle.com")?.id).toEqual(id);
	expect(getMemberByEmail("honk@dazzle.com")?.id).toEqual(id);
	expect(getMember(id)?.display_name).toEqual("Honk Dazzle");
	expect(getMember(1234)).toBeUndefined();
})

test('Create COLLISION', () => {
	createMember("nop@nopsledteam.com", "hehehehe");
	createMember("honk@dazzle.com", "Honk Dazzle");
	try {
		createMember("honk@dazzle.com", "Dude Perfect");
		fail("Should have thrown");

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (e: any) {
		expect(e.message).toEqual("Failed to create member");
	}
	expect(getMembersList().length).toEqual(2);
})

test('Create with google', () => {
	const id = createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
	const account = getGoogleAccount("123456789");
	expect(account?.member_id).toEqual(id);
	expect(getMember(account!.member_id)?.display_name).toEqual("Honk Dazzle");
})

test('Create with google COLLISION', () => {
	createMember("nop@nopsledteam.com", "hehehehe",  { google_sub: "987654321" });
	createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
	try {
		createMember("wummper@dazzle.com", "Dude Perfect", { google_sub: "123456789" });
		fail("Should have thrown");

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
		expect(err.message).toEqual("Failed to create member");
	}
	expect(getMembersList().length).toEqual(2);
})
