import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getMembersList } from "../db/members";
import { setDBFactory } from "../db/conn";

let memoryDb: Database.Database;
beforeEach(() => {
  memoryDb = new Database(':memory:');
	const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), 'utf-8')
	memoryDb.exec(schema);
	setDBFactory(() => memoryDb);
  // Seed data
});

test('insert and query', () => {
	expect(getMembersList()).toStrictEqual([]);
})

afterEach(() => {
  memoryDb.close();
});
