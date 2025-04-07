/**
 * Template definition for tooling directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the tooling directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import { MetadataTemplate } from '../types/template';

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
    title: {
      type: 'string',
      description: 'Title of the tool or service',
      validation: (value) => typeof value === 'string' && value.length > 0
    },
    tags: {
      type: 'array',
      description: 'Categorization tags',
      validation: (value) => Array.isArray(value) && value.length > 0,
      // First tag should match the subdirectory name
      defaultValueFn: (filePath: string) => {
        const pathParts = filePath.split('/');
        const directoryIndex = pathParts.indexOf('tooling') + 1;
        if (directoryIndex > 0 && directoryIndex < pathParts.length) {
          return [pathParts[directoryIndex]];
        }
        return ['Uncategorized'];
      }
    },
    date_modified: {
      type: 'date',
      description: 'Last modification date',
      defaultValueFn: () => {
        const today = new Date();
        return today.toISOString().split('T')[0];
      }
    }
  },
  
  // Optional fields that may be present in frontmatter
  optional: {
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the tool/service'
    },
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
