-- Up

CREATE TABLE tank_presets (
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE,
	preset_name TEXT NOT NULL,

	created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

	tank_size TEXT,
	filter_type TEXT,
	water_change_volume TEXT,
	water_change_frequency TEXT,
	temperature TEXT,
	ph TEXT,
	gh TEXT,
	specific_gravity TEXT,
	substrate_type TEXT,
	substrate_depth TEXT,
	substrate_color TEXT,

	PRIMARY KEY (member_id, preset_name)
);

-- Down

DROP TABLE IF EXISTS tank_presets;
