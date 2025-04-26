/**
 * Template definition for concepts directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the concepts directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import { MetadataTemplate } from '../types/template';
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';

/**
 * Template for concepts directory files
 * Based on observed patterns in existing files
 */
const conceptsTemplate: MetadataTemplate = {
  id: 'concepts',
  name: 'Concepts Document',
  description: 'Template for concept definition files',
  
  // Define which files this template applies to
  appliesTo: {
    directories: ['content/concepts/**/*'],
  },
  
  // Required fields that must be present in frontmatter
  required: {
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the concept entry',
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
        // Only generate a default value for new files or missing fields
        // This will be used when the field is missing, but won't trigger updates
        // to existing values
        return getCurrentDate();
      }
    },
  },
  
  // Optional fields that may be present in frontmatter
  optional: {
    related_concepts: {
      type: 'array',
      description: 'Related concept terms',
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

export default conceptsTemplate;