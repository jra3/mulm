import { checkPassword, makePasswordEntry } from "../auth.js";

test('hashy hash', async () => {
	const salty = await makePasswordEntry("hashy");
	expect(checkPassword(salty, "hashy")).toBe(true);
	expect(checkPassword(salty, "not hashy")).toBe(false);
});
