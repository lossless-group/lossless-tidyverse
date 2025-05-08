/**
 * Template definition for tooling directory frontmatter
 * 
 * This template defines the expected frontmatter structure for files in the tooling directory.
 * It includes required and optional fields, validation rules, and default values.
 */

import * as path from 'path'; 
import { MetadataTemplate } from '../types/template';
import { 
  generateUUID, 
  getFileCreationDate, 
  getCurrentDate,
  convertToTrainCase 
} from '../utils/commonUtils';

type InspectorStatus = "missing" | "malformed" | "empty" | "ok";

function generateTagsFromPath(filePath: string): string[] {
  try {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (!normalizedPath.includes('content/tooling/')) {
      console.log(`Path does not contain 'content/tooling/': ${filePath}`);
      return ['Uncategorized'];
    }
    const pathAfterTooling = normalizedPath.split('content/tooling/')[1];
    if (!pathAfterTooling) {
      console.log(`No path after 'content/tooling/' in: ${filePath}`);
      return ['Uncategorized'];
    }
    const dirParts = path.dirname(pathAfterTooling).split('/');
    if (dirParts.length === 0 || (dirParts.length === 1 && dirParts[0] === '.')) {
      console.log(`No directories after 'content/tooling/' in: ${filePath}`);
      return ['Uncategorized'];
    }
    const tags = dirParts.filter(dir => dir && dir !== '.').map(dir => convertToTrainCase(dir));
    if (tags.length === 0) {
      return ['Uncategorized'];
    }
    console.log(`Generated tags for ${filePath}: ${tags.join(', ')}`);
    return tags;
  } catch (error) {
    console.error(`Error generating tags for ${filePath}:`, error);
    return ['Uncategorized'];
  }
}

function requiredStringInspector(fieldName: string, allowEmpty: boolean = false): (value: any) => { status: InspectorStatus; message: string } {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (typeof value !== 'string') return { status: "malformed", message: `${fieldName} is not a string` };
    if (!allowEmpty && value.trim() === '') return { status: "empty", message: `${fieldName} is empty` };
    return { status: "ok", message: `${fieldName} is present` };
  };
}

function optionalStringInspector(fieldName: string): (value: any) => { status: InspectorStatus; message: string } {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: "ok", message: `${fieldName} is not present (optional)` }; 
    if (typeof value !== 'string') return { status: "malformed", message: `${fieldName} is not a string` };
    return { status: "ok", message: `${fieldName} is present and valid type` };
  };
}

function urlInspector(fieldName: string, allowEmpty: boolean = false): (value: any) => { status: InspectorStatus; message: string } {
  return (value: any) => {
    if (typeof value === 'undefined') {
      return allowEmpty ? { status: "ok", message: `${fieldName} is missing (optional and empty allowed)`} : { status: "missing", message: `${fieldName} is missing` };
    }
    if (typeof value !== 'string') return { status: "malformed", message: `${fieldName} is not a string` };
    if (!allowEmpty && value.trim() === '') return { status: "empty", message: `${fieldName} is empty` };
    if (value.trim() !== '' && !value.startsWith('http')) return { status: "malformed", message: `${fieldName} does not start with http(s)://` };
    return { status: "ok", message: `${fieldName} is a valid URL` };
  };
}

function arrayInspector(fieldName: string, allowEmpty: boolean = false): (value: any) => { status: InspectorStatus; message: string } {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (!Array.isArray(value)) return { status: "malformed", message: `${fieldName} is not an array` };
    if (!allowEmpty && value.length === 0) return { status: "empty", message: `${fieldName} is an empty array` };
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim() === '' && value.length === 1 && !allowEmpty) {
      return { status: "empty", message: `${fieldName} contains only an empty string` };
    }
    return { status: "ok", message: `${fieldName} is a valid array` };
  };
}

function dateInspector(fieldName: string): (value: any) => { status: InspectorStatus; message: string } {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (value === null) return { status: "ok", message: `${fieldName} is null (allowed for optional dates)` }; 
    if (typeof value !== 'string' && !(value instanceof Date)) return { status: "malformed", message: `${fieldName} is not a string or Date object` };
    if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      try {
        const d = new Date(value);
        if (isNaN(d.getTime())) return { status: "malformed", message: `${fieldName} is not a valid date string (YYYY-MM-DD or ISO)` };
      } catch (e) {
        return { status: "malformed", message: `${fieldName} is not a valid date string (YYYY-MM-DD or ISO)` };
      }
    }
    return { status: "ok", message: `${fieldName} is present and appears valid` };
  };
}

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
      inspection: requiredStringInspector('site_uuid'), 
      defaultValueFn: () => {
        return generateUUID();
      }
    },
    tags: {
      type: 'array',
      description: 'Categorization tags',
      inspection: arrayInspector('tags'), 
      defaultValueFn: generateTagsFromPath 
    },
    date_created: {
      type: 'date',
      description: 'Creation date',
      inspection: dateInspector('date_created'), 
      defaultValueFn: (filePath: string) => {
        return getFileCreationDate(filePath);
      }
    },
    date_modified: {
      type: 'date',
      description: 'Last modification date',
      inspection: dateInspector('date_modified'), 
      defaultValueFn: () => {
        return getCurrentDate();
      }
    },
  },
  
  // Optional fields that may be present in frontmatter
  optional: {
    url: {
      type: 'string',
      description: 'Official website URL',
      inspection: urlInspector('url', true) 
    },
    image: {
      type: 'string',
      description: 'Image URL for the tool/service',
      inspection: urlInspector('image', true) 
    },
    site_name: {
      type: 'string',
      description: 'Name of the site/tool',
      inspection: optionalStringInspector('site_name') 
    },
    favicon: {
      type: 'string',
      description: 'Favicon URL',
      inspection: urlInspector('favicon', true) 
    },
    youtube_channel_url: {
      type: 'string',
      description: 'YouTube channel URL',
      inspection: urlInspector('youtube_channel_url', true) 
    },
    og_screenshot_url: {
      type: 'string',
      description: 'Open Graph screenshot URL',
      inspection: urlInspector('og_screenshot_url', true) 
    },
    jina_last_request: {
      type: 'string',
      description: 'Timestamp of last Jina request',
      inspection: optionalStringInspector('jina_last_request') 
    },
    jina_error: {
      type: 'string',
      description: 'Error message from Jina',
      inspection: optionalStringInspector('jina_error') 
    },
    og_last_fetch: {
      type: 'string',
      description: 'Timestamp of last Open Graph fetch',
      inspection: optionalStringInspector('og_last_fetch') 
    }
  }
};

export default toolingTemplate;
