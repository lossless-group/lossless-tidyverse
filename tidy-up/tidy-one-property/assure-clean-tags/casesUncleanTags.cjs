const knownUncleanCases = {
   tagsWithinBrackets: [
      'tags: ["Build-Scripts", "YAML", "Frontmatter", "UUID", "Refactor", "Content-Generation"]'
   ],
   tagsHaveQuoteDelimiters: [ 
      'tags: ["Build-Scripts", "YAML", "Frontmatter", "UUID", "Refactor", "Content-Generation"]'
   ], 
   tagsNotTrainCase: [
      'tags:\n' +
      '  - \n' +  // Empty tag
      '  - refactoring\n' +
      '  - build-scripts\n' +
      '  - architecture\n' +
      '  - documentation'
   ],
   tagsWithEmptyLines: [
      'tags:\n' +
      '  - \n' +
      '  - Build-Scripts'
   ]
};

const tagsMayHaveInconsistentSyntax = {
   exampleErrors: [
       '',
       '---\n' +
       'url: https://www.archonlabs.com/\n' +
       'site_name: Archon Labs\n' +
       'tags: ["Technology-Consultants", "Organizations"]\n' +
       '---',
       '---\n' +
       'url: https://www.archonlabs.com/\n' +
       'site_name: Archon Labs\n' +
       'tags: Technology-Consultants, Organizations\n' +
       '---',
       '---\n' +
       'url: https://www.archonlabs.com/\n' +
       'site_name: Archon Labs\n' +
       'tags: \n' +
       '- Technology Consultants\n' +
       '- Organizations\n' +
       '---',
       '---\n' +
       'url: https://www.archonlabs.com/\n' +
       'site_name: Archon Labs\n' +
       'tags: \'Technology-Consultants\', \'Organizations\'\n' +
       '---'
   ],
   properSyntax: 
       '---\n' +
       'url: https://www.archonlabs.com/\n' +
       'site_name: Archon Labs\n' +
       'tags:\n' +
       '  - Technology-Consultants\n' +
       '  - Organizations\n' +
       '  - Open-Graph\n' +
       '---',
   detectError: new RegExp(/(?:tags:\s*(?:\[.*?\]|.*?,.*?|['"].*?['"])|(?:^|\n)\s*-\s*(?:\s*$|[a-z][a-z0-9-]*[a-z0-9](?![A-Z])))/),
   messageToLog: 'Tags may have inconsistent syntax, empty tags, or not be in Train-Case',
   preventsOperations: ['assureYAMLPropertiesCorrect.cjs', "function getCollection('tooling')"],
   correctionFunction: 'assureOrFixTagSyntaxInFrontmatter',
   isCritical: true
};

module.exports = { knownUncleanCases, tagsMayHaveInconsistentSyntax };