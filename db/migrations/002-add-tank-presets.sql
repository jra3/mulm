-- Up

CREATE TABLE tank_presets (
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE,
	preset_name TEXT NOT NULL,

	created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

	tank_size TEXT DEFAULT NULL,
	filter_type TEXT DEFAULT NULL,
	water_change_volume TEXT DEFAULT NULL,
	water_change_frequency TEXT DEFAULT NULL,
	temperature TEXT DEFAULT NULL,
	ph TEXT DEFAULT NULL,
	gh TEXT DEFAULT NULL,
	specific_gravity TEXT DEFAULT NULL,
	substrate_type TEXT DEFAULT NULL,
	substrate_depth TEXT DEFAULT NULL,
	substrate_color TEXT DEFAULT NULL,

	PRIMARY KEY (member_id, preset_name)
);

-- Down

DROP TABLE IF EXISTS tank_presets;
