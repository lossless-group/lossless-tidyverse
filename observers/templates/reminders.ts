// -----------------------------------------------------------------------------
// Canonical Reminders Template for Markdown Frontmatter
//
// This template defines the expected frontmatter structure for files in the
// reminders collection. It mirrors the rigor, validation, and DRY conventions
// of the prompts template, with field names and defaults adapted for reminders.
//
// Each field is commented with its purpose, validation, and defaulting logic.
// Validation functions are for reporting only—never auto-fix or mutate content.
// -----------------------------------------------------------------------------

import { MetadataTemplate } from '../types/template';
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';
import * as path from 'path';

/**
 * Template for reminders directory files
 * Based on canonical field order and validation patterns from prompts.ts
 */
const remindersTemplate: MetadataTemplate = {
  id: 'reminders',
  name: 'Reminders Document',
  description: 'Template for reminders documentation',

  // Define which files this template applies to
  appliesTo: {
    directories: ['content/lost-in-public/reminders/**/*'],
  },

  // Required fields that must be present in frontmatter
  required: {
    title: {
      type: 'string',
      description: 'Title of the reminder',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: (filePath) => {
        try {
          const filename = path.basename(filePath, '.md');
          return filename.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        } catch (error) {
          console.error(`Error generating title for ${filePath}:`, error);
          return 'Untitled Reminder';
        }
      }
    },
    lede: {
      type: 'string',
      description: 'Brief description of the reminder',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Brief description of the reminder functionality and purpose'
    },
    date_authored_initial_draft: {
      type: 'date',
      description: 'Date of initial draft authoring',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      defaultValueFn: () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    },
    date_authored_current_draft: {
      type: 'date',
      description: 'Date of current draft authoring',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      defaultValueFn: () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    },
    at_semantic_version: {
      type: 'string',
      description: 'Semantic version of the reminder',
      validation: (value) => typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value),
      defaultValueFn: () => '0.0.0.1'
    },
    authors: {
      type: 'array',
      description: 'Author(s) of the reminder',
      validation: (value) => {
        if (Array.isArray(value)) {
          return value.length > 0;
        } else if (typeof value === 'string') {
          return value.trim().length > 0;
        }
        return false;
      },
      defaultValueFn: () => ['Michael Staton']
    },
    status: {
      type: 'string',
      description: 'Current status of the reminder',
      validation: (value) => value === null || typeof value === 'string',
      defaultValueFn: () => 'To-Do'
    },
    augmented_with: {
      type: 'string',
      description: 'AI model used for augmentation',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Windsurf Cascade on Claude 3.5 Sonnet'
    },
    category: {
      type: 'string',
      description: 'Category of the reminder',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Reminders'
    },
    tags: {
      type: 'array',
      description: 'Categorization tags',
      validation: (value) => {
        if (Array.isArray(value)) {
          return value.length > 0;
        } else if (typeof value === 'string') {
          return value.trim().length > 0;
        }
        return false;
      },
      defaultValueFn: (filePath) => {
        try {
          const normalizedPath = filePath.replace(/\\/g, '/');
          if (!normalizedPath.includes('content/lost-in-public/reminders/')) {
            return ['Uncategorized'];
          }
          const pathAfterReminders = normalizedPath.split('content/lost-in-public/reminders/')[1];
          if (!pathAfterReminders) {
            return ['Uncategorized'];
          }
          const dirParts = pathAfterReminders.split('/');
          dirParts.pop();
          if (dirParts.length === 0) {
            return ['Uncategorized'];
          }
          return dirParts.map(dir => {
            const words = dir.split(/[-_\s]+/);
            return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('-');
          });
        } catch (error) {
          return ['Uncategorized'];
        }
      }
    },
    date_created: {
      type: 'date',
      description: 'Creation date',
      defaultValueFn: (filePath) => getFileCreationDate(filePath)
    },
    date_modified: {
      type: 'date',
      description: 'Last modification date',
      defaultValueFn: () => getCurrentDate()
    },
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the resource on the website',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => generateUUID()
    },
    // Reminders-specific required fields
    portrait_image: {
      type: 'string',
      description: 'URL for a tall, portrait-oriented image',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => ''
    },
    image_prompt: {
      type: 'string',
      description: 'Prompt describing the desired image for generative tools',
      validation: (value) => typeof value === 'string',
      defaultValueFn: () => ''
    }
  },

  // Optional fields that may be present in frontmatter
  optional: {
    date_authored_final_draft: {
      type: 'date',
      description: 'Date of final draft authoring',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    },
    date_first_published: {
      type: 'date',
      description: 'Date of first publication',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    },
    date_last_updated: {
      type: 'date',
      description: 'Date of last update',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    },
    date_first_run: {
      type: 'date',
      description: 'Date the reminder was first run',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    }
  }
};

export default remindersTemplate;