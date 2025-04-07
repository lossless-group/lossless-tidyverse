/**
 * Template definition for tooling directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the tooling directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import { MetadataTemplate } from '../types/template';
import { v4 as uuidv4 } from 'uuid';

/**
 * Template for tooling directory files
 * Based on observed patterns in existing files
 */
const toolingTemplate: MetadataTemplate = {
  id: 'tooling',
  name: 'Tooling Document',
  description: 'Template for tooling documentation files',
  
  // Define which files this template applies to
  appliesTo: {
    directories: ['content/tooling/**/*'],
  },
  
  // Required fields that must be present in frontmatter
  required: {
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the tool/service',
      validation: (value) => typeof value === 'string' && value.length > 0,
      defaultValueFn: () => {
        // Generate a new UUID v4
        return uuidv4();
      }
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
      // Extract all directory names after 'tooling/' and convert to Train-Case
      defaultValueFn: (filePath: string) => {
        try {
          console.log(`Generating tags for ${filePath}`);
          
          // Normalize path separators to forward slashes
          const normalizedPath = filePath.replace(/\\/g, '/');
          
          // Check if path contains 'content/tooling/'
          if (!normalizedPath.includes('content/tooling/')) {
            console.log(`Path does not contain 'content/tooling/': ${filePath}`);
            return ['Uncategorized'];
          }
          
          // Extract the part after 'content/tooling/'
          const pathAfterTooling = normalizedPath.split('content/tooling/')[1];
          
          if (!pathAfterTooling) {
            console.log(`No path after 'content/tooling/' in: ${filePath}`);
            return ['Uncategorized'];
          }
          
          // Get all directories after 'tooling' (excluding the filename)
          const dirParts = pathAfterTooling.split('/');
          // Remove the last part (filename)
          dirParts.pop();
          
          if (dirParts.length === 0) {
            console.log(`No directories after 'tooling/' in: ${filePath}`);
            return ['Uncategorized'];
          }
          
          // Convert the directory name to Train-Case
          const convertToTrainCase = (str: string): string => {
            if (!str || str.trim() === '') return 'Uncategorized';
            
            // Split by spaces, hyphens, or underscores
            const words = str.split(/[-_\s]+/);
            
            // Capitalize first letter of each word
            return words.map(word => {
              if (word.length === 0) return word;
              return word.charAt(0).toUpperCase() + word.slice(1);
            }).join('-');
          };
          
          // Convert all directory parts to Train-Case and use as tags
          const tags = dirParts.map(dir => convertToTrainCase(dir));
          
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
      defaultValueFn: (filePath: string) => {
        try {
          console.log(`Generating date_created for ${filePath}`);
          
          // Use the Node.js fs module (not fs/promises) for synchronous operations
          const fs = require('fs');
          
          // Check if file exists
          if (fs.existsSync(filePath)) {
            // Get file stats to access creation time
            const stats = fs.statSync(filePath);
            
            // Use birthtime (actual file creation time) which is reliable on Mac
            const timestamp = stats.birthtime;
            
            console.log(`File creation time for ${filePath}: ${timestamp.toISOString()}`);
            
            // Return full ISO string with timezone
            return timestamp.toISOString();
          } else {
            console.log(`File does not exist: ${filePath}`);
            // Return null instead of current date
            return null;
          }
        } catch (error) {
          console.error(`Error getting file stats for ${filePath}:`, error);
          // Return null instead of current date
          return null;
        }
      }
    },
    date_modified: {
      type: 'date',
      description: 'Last modification date',
      defaultValueFn: () => {
        const today = new Date();
        return today.toISOString().split('T')[0];
      }
    },
  },
  
  // Optional fields that may be present in frontmatter
  optional: {
    url: {
      type: 'string',
      description: 'Official website URL',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    },
    image: {
      type: 'string',
      description: 'Image URL for the tool/service',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    },
    site_name: {
      type: 'string',
      description: 'Name of the site/tool'
    },
    favicon: {
      type: 'string',
      description: 'Favicon URL',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    },
    youtube_channel_url: {
      type: 'string',
      description: 'YouTube channel URL',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    },
    og_screenshot_url: {
      type: 'string',
      description: 'Open Graph screenshot URL',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    },
    jina_last_request: {
      type: 'string',
      description: 'Timestamp of last Jina request'
    },
    jina_error: {
      type: 'string',
      description: 'Error message from Jina'
    },
    og_last_fetch: {
      type: 'string',
      description: 'Timestamp of last Open Graph fetch'
    }
  }
};

export default toolingTemplate;
