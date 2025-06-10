// Initialize tom-select for typeahead inputs
document.addEventListener('DOMContentLoaded', function() {
    initializeTypeaheads();
});

// Also initialize after HTMX content swaps
document.body.addEventListener('htmx:afterSwap', function() {
    initializeTypeaheads();
});

function initializeTypeaheads() {
    const typeaheadElements = document.querySelectorAll('.tom-select-typeahead:not(.tomselected)');
    
    typeaheadElements.forEach(function(element) {
        const apiUrl = element.dataset.apiUrl;
        const linkedFieldName = element.dataset.linkedField;
        
        if (!apiUrl) return;
        
        const tomSelect = new TomSelect(element, {
            valueField: 'value',
            labelField: 'text',
            searchField: ['text', 'email'],
            create: true, // Allow creating new entries
            maxItems: 1,
            load: function(query, callback) {
                if (query.length < 2) {
                    callback();
                    return;
                }
                
                fetch(apiUrl + '?q=' + encodeURIComponent(query))
                    .then(response => response.json())
                    .then(data => {
                        callback(data);
                    })
                    .catch(() => {
                        callback();
                    });
            },
            render: {
                option: function(item, escape) {
                    return '<div>' +
                        '<span class="font-medium">' + escape(item.text) + '</span>' +
                        (item.email ? '<br><span class="text-sm text-gray-500">' + escape(item.email) + '</span>' : '') +
                        '</div>';
                }
            },
            onChange: function(value) {
                // When a selection is made, update the linked field
                if (linkedFieldName && value) {
                    const selectedOption = this.options[value];
                    
                    if (selectedOption && selectedOption.email) {
                        const linkedElement = document.getElementById(linkedFieldName);
                        
                        if (linkedElement) {
                            // For member_name field, set the email in the linked field
                            if (linkedElement.tomselect) {
                                // It's a tom-select field
                                linkedElement.tomselect.clear();
                                linkedElement.tomselect.addOption({
                                    value: selectedOption.email,
                                    text: selectedOption.email,
                                    email: selectedOption.email,
                                    name: selectedOption.name || selectedOption.text
                                });
                                linkedElement.tomselect.setValue(selectedOption.email);
                            } else {
                                // It's a regular input field (like our email field)
                                linkedElement.value = selectedOption.email;
                            }
                        }
                    }
                }
            }
        });
    });
}