import { checkPassword, makePasswordEntry } from "../auth";

test('hashy hash', async () => {
	const salty = await makePasswordEntry("hashy");
	expect(await checkPassword(salty, "hashy")).toBe(true);
	expect(await checkPassword(salty, "not hashy")).toBe(false);
});
