/**
 * Template definition for specifications directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the specs directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import { MetadataTemplate } from '../types/template';
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';
import * as path from 'path';

/**
 * Template for specifications directory files
 * Based on observed patterns in existing files and requirements
 */
const specificationsTemplate: MetadataTemplate = {
  id: 'specifications',
  name: 'Technical Specification',
  description: 'Template for technical specifications documentation',
  
  // Define which files this template applies to
  appliesTo: {
    directories: ['content/specs/**/*'],
  },
  
  // Required fields that must be present in frontmatter
  required: {
    title: {
      type: 'string',
      description: 'Title of the specification',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: (filePath) => {
        try {
          // Extract filename without extension and convert to title case
          const filename = path.basename(filePath, '.md');
          return filename.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
        } catch (error) {
          console.error(`Error generating title for ${filePath}:`, error);
          return 'Untitled Specification';
        }
      }
    },
    lede: {
      type: 'string',
      description: 'Brief description of the specification',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Technical specification document outlining implementation details'
    },
    status: {
      type: 'string',
      description: 'Current status of the specification',
      validation: (value) => {
        const allowedValues = ['Draft', 'In-Review', 'Approved', 'Implemented', 'Deprecated'];
        return typeof value === 'string' && allowedValues.includes(value);
      },
      defaultValueFn: () => 'Draft'
    },
    authors: {
      type: 'array',
      description: 'Author(s) of the specification',
      validation: (value) => {
        // Handle various author formats
        if (Array.isArray(value)) {
          // Array format is already correct
          return value.length > 0;
        } else if (typeof value === 'string') {
          // If it's a string, it should be non-empty
          return value.trim().length > 0;
        }
        return false;
      },
      defaultValueFn: () => ['Michael Staton']
    },
    category: {
      type: 'string',
      description: 'Category of the specification',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Technical Specifications'
    },
    tags: {
      type: 'array',
      description: 'Categorization tags',
      validation: (value) => {
        // Handle various tag formats
        if (Array.isArray(value)) {
          // Array format is already correct
          return value.length > 0;
        } else if (typeof value === 'string') {
          // If it's a string, it might be a comma-separated list
          return value.trim().length > 0;
        }
        return false;
      },
      defaultValueFn: (filePath) => {
        try {
          // Extract filename without extension
          const filename = path.basename(filePath, '.md');
          // Split by hyphens and convert to tags
          return filename.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          );
        } catch (error) {
          console.error(`Error generating tags for ${filePath}:`, error);
          return ['Uncategorized'];
        }
      }
    },
    date_created: {
      type: 'date',
      description: 'Creation date',
      defaultValueFn: (filePath) => {
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
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the resource on the website',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => {
        // Generate a UUID v4 for the resource
        return generateUUID();
      }
    }
  },
  
  // Optional fields that may be present in frontmatter
  optional: {
    date_approved: {
      type: 'date',
      description: 'Date the specification was approved',
      validation: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    },
    date_implemented: {
      type: 'date',
      description: 'Date the specification was implemented',
      validation: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    },
    date_deprecated: {
      type: 'date',
      description: 'Date the specification was deprecated',
      validation: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    },
    related_specs: {
      type: 'array',
      description: 'Related specification documents',
      validation: (value) => Array.isArray(value)
    }
  }
};

export default specificationsTemplate;
