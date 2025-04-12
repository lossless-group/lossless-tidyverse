/**
 * Template definition for vocabulary directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the vocabulary directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import { MetadataTemplate } from '../types/template';
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';

/**
 * Template for vocabulary directory files
 * Based on observed patterns in existing files
 */
const vocabularyTemplate: MetadataTemplate = {
  id: 'vocabulary',
  name: 'Vocabulary Document',
  description: 'Template for vocabulary definition files',
  
  // Define which files this template applies to
  appliesTo: {
    directories: ['content/vocabulary/**/*'],
  },
  
  // Required fields that must be present in frontmatter
  required: {
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the vocabulary entry',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => {
        // Use the shared utility function for UUID generation
        return generateUUID();
      }
    },
    date_created: {
      type: 'date',
      description: 'Creation date',
      defaultValueFn: (filePath: string) => {
        // Use the shared utility function for file creation date
        return getFileCreationDate(filePath);
      }
    },
    date_modified: {
      type: 'date',
      description: 'Last modification date',
      defaultValueFn: () => {
        // Use the shared utility function for current date
        return getCurrentDate();
      }
    },
  },
  
  // Optional fields that may be present in frontmatter
  optional: {
    related_terms: {
      type: 'array',
      description: 'Related vocabulary terms',
      validation: (value) => Array.isArray(value)
    },
    aliases: {
      type: 'array',
      description: 'Alternative terms or synonyms',
      validation: (value) => Array.isArray(value)
    },
    wikipedia_url: {
      type: 'string',
      description: 'Wikipedia URL',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    }
  }
};

export default vocabularyTemplate;
