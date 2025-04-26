/**
 * Citations Template
 * 
 * Template for citation processing in markdown files.
 * This is the first template that processes content rather than just frontmatter.
 */

import { MetadataTemplate } from '../types/template';
import { processCitations } from '../services/citationService';

/**
 * Citations template for processing citations in markdown files
 * Applies to specific content directories and provides configuration
 * for citation processing
 */
export const citationsTemplate: MetadataTemplate = {
  id: 'citations',
  name: 'Citations Template',
  description: 'Template for citation processing in markdown files',
  
  // Define which files this template applies to
  appliesTo: {
    directories: [
      'content/lost-in-public/prompts/**/*',
      'content/specs/**/*',
      // Add other directories that should have citations processed
    ],
  },
  
  // Required fields - empty since this template only processes content
  required: {},
  
  // Optional fields - empty since this template only processes content
  optional: {},
  
  // Configuration for citation processing
  citationConfig: {
    // Registry path configuration
    registryPath: 'site/src/content/citations/citation-registry.json',
    // Hex ID configuration
    hexLength: 6,
    // Footnotes section configuration
    footnotesSectionHeader: '# Footnotes',
    footnotesSectionSeparator: '***'
  },
  
  // Content processing capability
  contentProcessing: {
    enabled: true,
    processor: async (content: string, filePath: string) => {
      // Process citations using the citation service
      // Pass the citation configuration from the template
      const result = await processCitations(
        content, 
        filePath,
        citationsTemplate.citationConfig
      );
      
      return {
        updatedContent: result.updatedContent,
        changed: result.changed,
        stats: result.stats
      };
    }
  }
};
