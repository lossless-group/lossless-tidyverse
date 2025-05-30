// =============================================================================
// Inspector-Only Essays Template for Markdown Frontmatter
//
// This template defines the canonical frontmatter structure for essays in content/essays.
// It enforces the INSPECTOR-ONLY pattern as per project rules:
//   - If a required property does not exist, assert and write with '' (empty string).
//   - If property exists but is '', report as 'empty' but do not treat as error or fix.
//   - If property is malformed, report as 'malformed' but do not enforce or fix.
//   - All inspection results are for reporting only—never for enforcement or hard validation.
//   - All logic here must be idempotent and non-destructive.
//
// This template is used by Watchers/Observers to assess if frontmatter is complete and valid.
// =============================================================================

import { MetadataTemplate } from '../types/template';
import { addDateCreated } from '../handlers/addDateCreated';

// Wrapper to adapt addDateCreated to the required signature
function addDateCreatedWrapper(filePath: string, frontmatter?: Record<string, any>) {
  // addDateCreated returns { changes: { date_created?: string } } 
  // but we need a simple string for defaultValueFn
  const result = addDateCreated(frontmatter ?? {}, filePath);
  
  // Extract date_created if available
  if (result.changes && result.changes.date_created) {
    return result.changes.date_created;
  }
  
  // If no date_created is available in the result, check if it's already in frontmatter
  if (frontmatter && frontmatter.date_created) {
    return frontmatter.date_created;
  }
  
  // Last resort fallback to today's date
  return getTodaysDateYYYYMMDD();
}

function addSiteUUIDWrapper(filePath: string, frontmatter?: Record<string, any>) {
  // We need to return a simple string UUID, not an object
  
  // First check if frontmatter already has a valid UUID
  if (frontmatter && frontmatter.site_uuid && typeof frontmatter.site_uuid === 'string' && 
      /^[0-9a-fA-F-]{36}$/.test(frontmatter.site_uuid)) {
    return frontmatter.site_uuid;
  }
  
  // If no valid UUID in frontmatter, generate a new one directly
  // Rather than using the handler which returns an object
  const { generateUUID } = require('../utils/commonUtils');
  return generateUUID();
}

// Returns today's date as 'YYYY-MM-DD' string, no arguments required.
function getTodaysDateYYYYMMDD(): string {
  // Uses the current system date, formats as 'YYYY-MM-DD'.
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Wrapper for template defaultValueFn signature (filePath: string, frontmatter?: Record<string, any>) => string
function addTodaysDateInFormatWrapper(filePath: string, frontmatter?: Record<string, any>) {
  return getTodaysDateYYYYMMDD();
}

// Utility function to take a filename, remove the .md extension, and replace dashes with spaces.
function filenameToTitle(filePath: string): string {
  // Extract just the filename without the path
  const path = require('path');
  const filename = path.basename(filePath);
  
  // Remove the .md extension if present
  let name = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
  
  // Replace all dashes with spaces
  name = name.replace(/-/g, ' ');
  
  // Capitalize the first letter of each word
  name = name.split(' ')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
    
  return name;
}

type InspectorStatus = "missing" | "malformed" | "empty" | "ok";

function requiredStringInspector(fieldName: string) {
  return (value: any): { status: InspectorStatus; message: string } => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (typeof value !== 'string') return { status: "malformed", message: `${fieldName} is not a string` };
    if (value.trim() === '') return { status: "empty", message: `${fieldName} is present but empty` };
    return { status: "ok", message: `${fieldName} is present` };
  };
}
function requiredArrayInspector(fieldName: string) {
  return (value: any): { status: InspectorStatus; message: string } => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (!Array.isArray(value)) return { status: "malformed", message: `${fieldName} is not an array` };
    if (value.length === 0) return { status: "empty", message: `${fieldName} array is empty` };
    return { status: "ok", message: `${fieldName} is present` };
  };
}
function dateInspector(fieldName: string) {
  return (value: any): { status: InspectorStatus; message: string } => {
    if (typeof value === 'undefined') return { status: "missing", message: `${fieldName} is missing` };
    if (value === null) return { status: "ok", message: `${fieldName} is null (allowed)` };
    if (typeof value !== 'string') return { status: "malformed", message: `${fieldName} is not a string` };
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return { status: "malformed", message: `${fieldName} is not YYYY-MM-DD` };
    return { status: "ok", message: `${fieldName} is present` };
  };
}

const essaysTemplate: MetadataTemplate = {
  id: 'essays',
  name: 'Essay Document',
  description: 'Template for essays in the content/essays directory (INSPECTOR-ONLY)',
  appliesTo: {
    directories: ['content/essays/**/*'],
  },
  required: {
    title: { type: 'string', description: 'Title', inspection: requiredStringInspector('title'), defaultValueFn: filenameToTitle },
    lede: { type: 'string', description: 'Brief description', inspection: requiredStringInspector('lede'), defaultValueFn: () => '' },
    date_authored_initial_draft: { type: 'date', description: 'Date of initial draft', inspection: dateInspector('date_authored_initial_draft'), defaultValueFn: addDateCreatedWrapper },
    date_authored_current_draft: { type: 'date', description: 'Date of current draft', inspection: dateInspector('date_authored_current_draft'), defaultValueFn: addTodaysDateInFormatWrapper },
    at_semantic_version: { type: 'string', description: 'Semantic version', inspection: requiredStringInspector('at_semantic_version'), defaultValueFn: () => '0.0.0.1' },
    status: { type: 'string', description: 'Status', inspection: requiredStringInspector('status'), defaultValueFn: () => 'To-Do' },
    augmented_with: { type: 'string', description: 'AI model used', inspection: requiredStringInspector('augmented_with'), defaultValueFn: () => 'Perplexica AI' },
    category: { type: 'string', description: 'Category', inspection: requiredStringInspector('category'), defaultValueFn: () => '' },
    tags: { type: 'array', description: 'Tags', inspection: requiredArrayInspector('tags'), defaultValueFn: () => [] },
    date_created: { type: 'date', description: 'Creation date', inspection: dateInspector('date_created'), defaultValueFn: addDateCreatedWrapper },
    date_modified: { type: 'date', description: 'Last modification date', inspection: dateInspector('date_modified'), defaultValueFn: addTodaysDateInFormatWrapper },
    site_uuid: { type: 'string', description: 'Unique identifier', inspection: requiredStringInspector('site_uuid'), defaultValueFn: addSiteUUIDWrapper },
    authors: { type: 'array', description: 'Authors', inspection: requiredArrayInspector('authors'), defaultValueFn: () => ['Michael Staton'] },
    portrait_image: { type: 'string', description: 'Portrait image URL', inspection: requiredStringInspector('portrait_image'), defaultValueFn: () => '' },
    image_prompt: { type: 'string', description: 'Image prompt for generative tools', inspection: requiredStringInspector('image_prompt'), defaultValueFn: () => '' },
    banner_image: { type: 'string', description: 'Banner image URL', inspection: requiredStringInspector('banner_image'), defaultValueFn: () => '' },
  },
  optional: {
    date_authored_final_draft: { type: 'date', description: 'Date of final draft', inspection: dateInspector('date_authored_final_draft'), defaultValueFn: () => null },
    date_first_published: { type: 'date', description: 'Date of first publication', inspection: dateInspector('date_first_published'), defaultValueFn: () => null },
    date_last_updated: { type: 'date', description: 'Date of last update', inspection: dateInspector('date_last_updated'), defaultValueFn: () => null },
    publish: { type: 'boolean', description: 'Publish flag', defaultValueFn: () => false },
  }
};

export default essaysTemplate;