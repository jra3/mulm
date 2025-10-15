function getTypeaheadConfig(element) {
	const labelField = element.dataset.labelField || 'text';
	let searchFields = ['text'];

	if (element.dataset.searchFields) {
		const fields = element.dataset.searchFields.split(',').map(f => f.trim()).filter(f => f);
		if (fields.length > 0) {
			searchFields = fields;
		}
	}

	return {
		apiUrl: element.dataset.apiUrl,
		linkedField: element.dataset.linkedField,
		linkedValueField: element.dataset.linkedValueField,
		hiddenIdField: element.dataset.hiddenIdField,
		hiddenIdValueField: element.dataset.hiddenIdValueField,
		valueField: element.dataset.valueField || 'value',
		labelField: labelField,
		searchFields: searchFields,
		minQueryLength: parseInt(element.dataset.minQueryLength) || 2,
		maxItems: parseInt(element.dataset.maxItems) || 1,
		allowCreate: element.dataset.allowCreate === 'true',
		placeholder: element.dataset.placeholder || element.placeholder || '',
		loadingClass: element.dataset.loadingClass || 'loading',
		debounceMs: parseInt(element.dataset.debounceMs) || 300,
		createOnBlur: element.dataset.createOnBlur === "true",
	};
}

function buildTomSelectOptions(element, config) {
	return {
		valueField: config.valueField,
		labelField: config.labelField,
		searchField: config.searchFields || [config.labelField],
		create: config.allowCreate,
		createOnBlur: config.createOnBlur,
		maxItems: config.maxItems,
		placeholder: config.placeholder,

		load: function (query, callback) {
			if (query.length < config.minQueryLength) {
				callback();
				return;
			}

			element.classList.add(config.loadingClass);
			performFetchSearch(element, config, query, callback);
		},

		render: {
			option: function(item, escape) {
				return renderOption(item, escape, element);
			},
			loading: function(data, escape) {
				return '<div class="loading-indicator">Searching...</div>';
			}
		},

		onChange: function (value) {
			const selectedOption = this.options[value];

			// Sync TomSelect internal state to underlying select element
			this.sync();

			element.dispatchEvent(new CustomEvent('typeahead:change', {
				detail: { value, selectedOption },
				bubbles: true
			}));

			// Auto-populate linked field if configured
			if (config.linkedField && config.linkedValueField && selectedOption) {
				const linkedElement = document.getElementById(config.linkedField);
				if (linkedElement && linkedElement.tomSelectInstance) {
					const linkedValue = selectedOption[config.linkedValueField];
					if (linkedValue) {
						const linkedInstance = linkedElement.tomSelectInstance;
						const linkedConfig = getTypeaheadConfig(linkedElement);

						// Create option object using the linked field's configuration
						const linkedOption = {
							[linkedConfig.valueField]: linkedValue,
							[linkedConfig.labelField]: linkedValue,
							// Copy over all the original data for compatibility
							...selectedOption
						};

						// Ensure secondary field is properly set
						if (linkedConfig.secondaryField && selectedOption[linkedConfig.secondaryField]) {
							linkedOption[linkedConfig.secondaryField] = selectedOption[linkedConfig.secondaryField];
						}

						// Add the option if it doesn't exist yet
						if (!linkedInstance.options[linkedValue]) {
							linkedInstance.addOption(linkedOption);
						}
						// Set the value
						// Clear and set to force visual update
						linkedInstance.clear(true);
						linkedInstance.setValue(linkedValue, true); // silent=false to trigger change
					}
				}
			}

			// Populate hidden ID field if configured
			if (config.hiddenIdField && config.hiddenIdValueField && selectedOption) {
				const hiddenElement = document.getElementById(config.hiddenIdField);
				if (hiddenElement) {
					const hiddenValue = selectedOption[config.hiddenIdValueField];
					if (hiddenValue !== undefined && hiddenValue !== null) {
						hiddenElement.value = hiddenValue;
						// Dispatch change event for HTMX listeners
						hiddenElement.dispatchEvent(new Event('change', { bubbles: true }));
					}
				}
			}
		},

		onLoad: function() {
			element.classList.remove(config.loadingClass);
		}
	};
}

function performFetchSearch(element, config, query, callback) {
	const url = new URL(config.apiUrl, window.location.origin);
	url.searchParams.set('q', query);

	// Add any additional parameters from data attributes
	Object.keys(element.dataset).forEach(key => {
		if (key.startsWith('param')) {
			const paramName = key.replace('param', '').toLowerCase();
			url.searchParams.set(paramName, element.dataset[key]);
		}
	});

	fetch(url)
		.then(response => response.json())
		.then(data => {
			element.classList.remove(config.loadingClass);
			callback(data);
		})
		.catch(error => {
			console.error('Typeahead search error:', error);
			element.classList.remove(config.loadingClass);
			callback();
		});
}

function renderOption(item, escape, element) {
	const template = element.dataset.optionTemplate;

	if (template) {
		// Use custom template if provided
		return template
			.replace(/\{\{(\w+)\}\}/g, (match, field) => {
				return escape(item[field] || '');
			});
	}

	// Default rendering
	let html = '<div>';
	html += '<span class="font-medium">' + escape(item[element.dataset.labelField || 'text']) + '</span>';

	// Add secondary text if available
	const secondaryField = element.dataset.secondaryField;
	if (secondaryField && item[secondaryField]) {
		html += '<br><span class="text-sm text-gray-500">' + escape(item[secondaryField]) + '</span>';
	}

	html += '</div>';
	return html;
}
