module.exports = {
  // Allow class="..." attributes for complex Tailwind utilities
  "disallowClassAttributeWithStaticValue": null,
  
  // Allow mixed class syntax (both .class and class="...")
  "requireClassLiteralsBeforeAttributes": null,
  
  // Enforce double quotes for consistency
  "validateAttributeQuoteMarks": "\"",
  
  // Consistent attribute formatting
  "validateAttributeSeparator": {
    "separator": " ",
    "multiLineSeparator": "\n\t"
  },
  
  // Reasonable line length for Tailwind classes
  "maximumLineLength": 140,
  
  // Consistent indentation
  "validateIndentation": "\t",
  
  // Ensure consistent template formatting
  "disallowMultipleLineBreaks": true,
  "requireLowerCaseAttributes": true,
  "requireLowerCaseTags": true,
  
  // Allow template literals and expressions in class attributes
  "disallowTemplateString": null,
  
  // File patterns to lint
  "excludeFiles": [
    "**/node_modules/**",
    "**/dist/**"
  ]
}