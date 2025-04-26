/**
 * Template definition for prompts directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the prompts directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import { MetadataTemplate } from '../types/template';
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';
import * as path from 'path';

/**
 * Template for prompts directory files
 * Based on observed patterns in existing files and requirements
 */
const promptsTemplate: MetadataTemplate = {
  id: 'prompts',
  name: 'Prompts Document',
  description: 'Template for prompt documentation',
  
  // Define which files this template applies to
  appliesTo: {
    directories: ['content/lost-in-public/prompts/**/*'],
  },
  
  // Required fields that must be present in frontmatter
  required: {
    title: {
      type: 'string',
      description: 'Title of the prompt',
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
          return 'Untitled Prompt';
        }
      }
    },
    lede: {
      type: 'string',
      description: 'Brief description of the prompt',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Brief description of the prompt functionality and purpose'
    },
    date_authored_initial_draft: {
      type: 'date',
      description: 'Date of initial draft authoring',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      defaultValueFn: () => {
        // CRITICAL: Only use YYYY-MM-DD format, never include time component
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`; // YYYY-MM-DD format only
      }
    },
    date_authored_current_draft: {
      type: 'date',
      description: 'Date of current draft authoring',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      defaultValueFn: () => {
        // CRITICAL: Only use YYYY-MM-DD format, never include time component
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`; // YYYY-MM-DD format only
      }
    },
    at_semantic_version: {
      type: 'string',
      description: 'Semantic version of the prompt',
      validation: (value) => typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value),
      defaultValueFn: () => '0.0.0.1'
    },
    authors: {
      type: 'array',
      description: 'Author(s) of the prompt',
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
    status: {
      type: 'string',
      description: 'Current status of the prompt',
      validation: (value) => value === null || typeof value === 'string',
      defaultValueFn: () => 'To-Prompt'
    },
    augmented_with: {
      type: 'string',
      description: 'AI model used for augmentation',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Windsurf Cascade on Claude 3.5 Sonnet'
    },
    category: {
      type: 'string',
      description: 'Category of the prompt',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => 'Prompts'
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
          console.log(`Generating tags for ${filePath}`);
          
          // Normalize path separators to forward slashes
          const normalizedPath = filePath.replace(/\\/g, '/');
          
          // Check if path contains 'content/lost-in-public/prompts/'
          if (!normalizedPath.includes('content/lost-in-public/prompts/')) {
            console.log(`Path does not contain 'content/lost-in-public/prompts/': ${filePath}`);
            return ['Uncategorized'];
          }
          
          // Extract the part after 'content/lost-in-public/prompts/'
          const pathAfterPrompts = normalizedPath.split('content/lost-in-public/prompts/')[1];
          
          if (!pathAfterPrompts) {
            console.log(`No path after 'content/lost-in-public/prompts/' in: ${filePath}`);
            return ['Uncategorized'];
          }
          
          // Get all directories after 'prompts' (excluding the filename)
          const dirParts = pathAfterPrompts.split('/');
          // Remove the last part (filename)
          dirParts.pop();
          
          if (dirParts.length === 0) {
            console.log(`No directories after 'prompts/' in: ${filePath}`);
            return ['Uncategorized'];
          }
          
          // Convert all directory parts to Train-Case and use as tags
          const tags = dirParts.map(dir => {
            // Split by spaces, hyphens, or underscores
            const words = dir.split(/[-_\s]+/);
            
            // Capitalize first letter of each word
            return words.map(word => {
              if (word.length === 0) return word;
              return word.charAt(0).toUpperCase() + word.slice(1);
            }).join('-');
          });
          
          console.log(`Generated tags for ${filePath}: ${tags.join(', ')}`);
          
          return tags;
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
      description: 'Date the prompt was first run',
      validation: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    }
  }
};

export default promptsTemplate;
