import fs from 'fs';
import path from 'path';
import { createMember, getGoogleAccount, getMember, getMemberByEmail, getMembersList } from "../db/members";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { overrideConnection } from "../db/conn";

beforeAll(() => {
	fs.mkdirSync("/tmp/mulm");
});

let instance = 1;
beforeEach(async () => {
	const tmpConn = await open({
		filename: `/tmp/mulm/database-${instance++}.sqlite`,
		driver: sqlite3.cached.Database,
		mode: sqlite3.OPEN_READONLY,
	});

	const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), 'utf-8')
	tmpConn.exec(schema);
	overrideConnection(tmpConn);

});

afterAll(() => {
	fs.rmdirSync("/tmp/mulm", { recursive: true });
});

test('Members list append', async () => {
	expect((await getMembersList()).length).toEqual(0);
	createMember("honk@dazzle.com", "Honk Dazzle");
	expect((await getMembersList()).length).toEqual(1);
})

test('Create and fetch', async () => {
	const id = await createMember("honk@dazzle.com", "Honk Dazzle");
	expect((await getMemberByEmail("honk@dazzle.com"))?.id).toEqual(id);
	expect((await getMemberByEmail("honk@dazzle.com"))?.id).toEqual(id);
	expect((await getMember(id))?.display_name).toEqual("Honk Dazzle");
	expect((await getMember(1234))).toBeUndefined();
})

test('Create COLLISION', async () => {
	createMember("nop@nopsledteam.com", "hehehehe");
	createMember("honk@dazzle.com", "Honk Dazzle");
	try {
		createMember("honk@dazzle.com", "Dude Perfect");
		fail("Should have thrown");

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (e: any) {
		expect(e.message).toEqual("Failed to create member");
	}
	expect((await getMembersList()).length).toEqual(2);
})

test('Create with google', async () => {
	const id = createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
	const member_id = await getGoogleAccount("123456789");
	expect(member_id).toEqual(id);
	expect((await getMember(member_id!.member_id))?.display_name).toEqual("Honk Dazzle");
})

test('Create with google COLLISION', async () => {
	createMember("nop@nopsledteam.com", "hehehehe",  { google_sub: "987654321" });
	createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
	try {
		createMember("wummper@dazzle.com", "Dude Perfect", { google_sub: "123456789" });
		fail("Should have thrown");

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
		expect(err.message).toEqual("Failed to create member");
	}
	expect((await getMembersList()).length).toEqual(2);
})
