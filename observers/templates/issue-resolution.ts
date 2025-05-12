// =============================================================================
// Inspector-Only Issue Resolution Template for Markdown Frontmatter
//
// This template defines the canonical frontmatter structure for issue resolution documents.
// It follows INSPECTOR-ONLY patterns: reports issues, does not enforce/fix.
// Used by Watchers/Observers for assessing frontmatter completeness and validity.
// =============================================================================

import { MetadataTemplate } from '../types/template';
import { 
  generateUUID, 
  getFileCreationDate, 
  getCurrentDate, 
  formatDate 
} from '../utils/commonUtils';

// Types for inspector statuses
// Only these literal values are allowed for status
type InspectorStatus = "missing" | "malformed" | "empty" | "ok";

// LOCAL HELPER FUNCTIONS
// ======================

// Utility function to take a filename, remove the .md extension, and replace dashes with spaces.
// Copied from essays.ts - TODO: Move to a common utility
function filenameToTitle(filePath: string, frontmatter?: Record<string, any>): string {
  const path = require('path'); // Node.js path module
  const filename = path.basename(filePath);
  let name = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
  name = name.replace(/-/g, ' '); // Replace all dashes with spaces
  // Capitalize the first letter of each word
  name = name.split(' ')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return name;
}

// Inspector for required string fields.
// Handles 'optionalButNotEmpty' logic: if true, field can be absent, but if present, must not be empty.
// Copied and adapted from tooling.ts/essays.ts - TODO: Move to a common utility
function requiredStringInspector(fieldName: string, optionalButNotEmpty: boolean = false) {
  return (value: any): { status: InspectorStatus; message: string } => {
    if (typeof value === 'undefined') {
      // If field is optional and missing, it's 'ok'. Otherwise, it's 'missing'.
      return optionalButNotEmpty 
        ? { status: "ok", message: `${fieldName} is optional and not provided` } 
        : { status: "missing", message: `${fieldName} is missing` };
    }
    if (typeof value !== 'string') {
      return { status: "malformed", message: `${fieldName} is not a string` };
    }
    if (value.trim() === '') {
      // An empty string is problematic whether the field was strictly required or optionalButNotEmpty.
      return { status: "empty", message: `${fieldName} is present but empty` };
    }
    return { status: "ok", message: `${fieldName} is present and valid` };
  };
}

// Inspector for required array fields.
// Handles 'optionalButNotEmpty' logic similar to string inspector.
// Copied from essays.ts - TODO: Move to a common utility
function requiredArrayInspector(fieldName: string, optionalButNotEmpty: boolean = false) {
  return (value: any): { status: InspectorStatus; message: string } => {
    if (typeof value === 'undefined') {
      return optionalButNotEmpty 
        ? { status: "ok", message: `${fieldName} is optional and not provided` } 
        : { status: "missing", message: `${fieldName} is missing` };
    }
    if (!Array.isArray(value)) {
      return { status: "malformed", message: `${fieldName} is not an array` };
    }
    // For arrays, 'optionalButNotEmpty' usually means if the key exists, it should not be an empty array.
    // However, an empty array can also be a valid state for optional fields.
    // Sticking to a simpler check: if required (optionalButNotEmpty=false) and empty, it's an issue.
    // If optional (optionalButNotEmpty=true), an empty array might be acceptable (depends on specific field needs).
    // For now, mirroring essays.ts: empty array is 'empty' status if not strictly optional.
    if (value.length === 0 && !optionalButNotEmpty) { 
      return { status: "empty", message: `${fieldName} array is present but empty` };
    }
    return { status: "ok", message: `${fieldName} is present and valid` };
  };
}

// Inspector for date fields (YYYY-MM-DD format)
function dateInspector(fieldName: string) {
  return (value: any): { status: InspectorStatus; message: string } => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (value === null) return { status: "ok", message: `${fieldName} is null (allowed)` };
    if (typeof value !== 'string') return { status: "malformed", message: `${fieldName} is not a string` };
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return { status: "malformed", message: `${fieldName} is not YYYY-MM-DD` };
    return { status: "ok", message: `${fieldName} is present` };
  };
}

// Wrapper for date_created
function addDateCreatedWrapper(filePath: string, frontmatter?: Record<string, any>): string | null {
  if (frontmatter && frontmatter.date_created) {
    return formatDate(frontmatter.date_created); // Ensure consistent format if already present
  }
  return getFileCreationDate(filePath);
}

// Wrapper for date_modified (using current date)
function addTodaysDateInFormatWrapper(filePath: string, frontmatter?: Record<string, any>): string {
  // frontmatter?.date_modified could be checked if we want to preserve an existing date_modified
  // but typically date_modified should update to current on save if changed.
  return getCurrentDate(); 
}

// Function to be used as defaultValueFn for site_uuid
function addSiteUUIDWrapper(filePath: string, frontmatter?: Record<string, any>): string {
  // We need to return a simple string UUID, not an object
  
  // First check if frontmatter already has a valid UUID
  if (frontmatter && frontmatter.site_uuid && typeof frontmatter.site_uuid === 'string' && 
      /^[0-9a-fA-F-]{36}$/.test(frontmatter.site_uuid)) {
    return frontmatter.site_uuid;
  }
  
  // If no valid UUID in frontmatter, generate a new one directly
  return generateUUID(); // Directly use imported generateUUID
}

const _issueResolutionTemplate: MetadataTemplate = {
  id: 'issue-resolution',
  name: 'Issue Resolution Document',
  description: 'Template for documents in the lost-in-public/issue-resolution directory. Specifies required and optional frontmatter fields.',
  appliesTo: {
    directories: ['lost-in-public/issue-resolution/**/*'], // Adjusted path if necessary
  },
  required: {
    title: { type: 'string', description: 'Title of the issue', inspection: requiredStringInspector('title'), defaultValueFn: filenameToTitle },
    status: { type: 'string', description: 'Current status of the issue (e.g., Open, In Progress, Resolved, Closed)', inspection: requiredStringInspector('status'), defaultValueFn: () => 'Open' },
    affected_systems: { type: 'string', description: 'Systems or components affected by the issue', inspection: requiredStringInspector('affected_systems'), defaultValueFn: () => '' },
    category: { type: 'string', description: 'Category of the issue (e.g., Bug, Feature Request, Documentation)', inspection: requiredStringInspector('category'), defaultValueFn: () => 'Bug' },
    lede: { type: 'string', description: 'Brief, enticing description why the issue is important', inspection: requiredStringInspector('lede'), defaultValueFn: () => '' },
    date_reported: { type: 'date', description: 'Date the issue was reported', inspection: dateInspector('date_reported'), defaultValueFn: () => null },
    date_resolved: { type: 'date', description: 'Date the issue was resolved', inspection: dateInspector('date_resolved'), defaultValueFn: () => null },
    date_last_updated: { type: 'date', description: 'Date the issue was last updated', inspection: dateInspector('date_last_updated'), defaultValueFn: () => null },
    at_semantic_version: { type: 'string', description: 'Semantic version at time of issue using 4 segments (epic.major.minor.patch)', inspection: requiredStringInspector('at_semantic_version'), defaultValueFn: () => '0.0.0.0' },
    date_created: { type: 'date', description: 'Date the issue was logged', inspection: dateInspector('date_created'), defaultValueFn: addDateCreatedWrapper },
    date_modified: { type: 'date', description: 'Date the issue was last modified', inspection: dateInspector('date_modified'), defaultValueFn: addTodaysDateInFormatWrapper },
    site_uuid: { type: 'string', description: 'Unique identifier for the site', inspection: requiredStringInspector('site_uuid'), defaultValueFn: addSiteUUIDWrapper },
    augmented_with: { type: 'string', description: 'AI model used for assistance', inspection: requiredStringInspector('augmented_with', true), defaultValueFn: () => '' }, 
    tags: { type: 'array', description: 'Relevant tags', inspection: requiredArrayInspector('tags'), defaultValueFn: () => ['type/issue-resolution'] },
    portrait_image: { type: 'string', description: 'Relevant image if any (e.g. screenshot)', inspection: requiredStringInspector('portrait_image', true), defaultValueFn: () => '' },
    image_prompt: { type: 'string', description: 'Prompt for image if generative', inspection: requiredStringInspector('image_prompt', true), defaultValueFn: () => '' },
    banner_image: { type: 'string', description: 'Banner image if any', inspection: requiredStringInspector('banner_image', true), defaultValueFn: () => '' },
  },
  optional: {
    priority: { type: 'string', description: 'Priority of the issue (e.g., Low, Medium, High, Critical)', inspection: requiredStringInspector('priority'), defaultValueFn: () => 'Medium' },
    author_issuer: { type: 'string', description: 'Person or system that reported the issue', inspection: requiredStringInspector('reporter'), defaultValueFn: () => '' }, // Could default to a username or system ID
    author_resolver: { type: 'string', description: 'Person or team assigned to the issue', inspection: requiredStringInspector('assignee', true), defaultValueFn: () => '' }, // Optional, but if present, not empty
    resolved_at: { type: 'date', description: 'Date the issue was resolved', inspection: dateInspector('resolved_at'), defaultValue: null },
    authors: { type: 'array', description: 'People involved in reporting/resolving', inspection: requiredArrayInspector('authors', true), defaultValueFn: () => [] }, // e.g. ['Reporter Name', 'Assignee Name']
    resolution_summary: { type: 'string', description: 'Summary of the resolution', inspection: requiredStringInspector('resolution_summary', true), defaultValue: '' }, // Optional, but if present, not empty
    severity: { type: 'string', description: 'Severity of the issue (e.g., Minor, Major, Critical)', inspection: requiredStringInspector('severity', true), defaultValueFn: () => '' },
    publish: { type: 'boolean', description: 'Should this issue be published?', inspection: requiredStringInspector('publish'), defaultValueFn: () => true },
  }
}; 

// Export the modified template directly
export const issueResolutionTemplate = _issueResolutionTemplate;
