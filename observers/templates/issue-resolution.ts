// =============================================================================
// Inspector-Only Issue Resolution Template for Markdown Frontmatter
//
// This template defines the canonical frontmatter structure for issue-resolution files.
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
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';

// Inspector helpers (copied from reminders template)
function requiredStringInspector(fieldName: string) {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: 'missing', message: `${fieldName} is missing` };
    if (typeof value !== 'string') return { status: 'malformed', message: `${fieldName} is not a string` };
    if (value.trim() === '') return { status: 'empty', message: `${fieldName} is present but empty` };
    return { status: 'ok', message: `${fieldName} is present` };
  };
}
function requiredArrayInspector(fieldName: string) {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: 'missing', message: `${fieldName} is missing` };
    if (!Array.isArray(value)) return { status: 'malformed', message: `${fieldName} is not an array` };
    if (value.length === 0) return { status: 'empty', message: `${fieldName} array is empty` };
    return { status: 'ok', message: `${fieldName} is present` };
  };
}
function dateInspector(fieldName: string) {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: 'missing', message: `${fieldName} is missing` };
    if (value === null) return { status: 'ok', message: `${fieldName} is null (allowed)` };
    if (typeof value !== 'string') return { status: 'malformed', message: `${fieldName} is not a string` };
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return { status: 'malformed', message: `${fieldName} is not YYYY-MM-DD` };
    return { status: 'ok', message: `${fieldName} is present` };
  };
}

const issueResolutionTemplate: MetadataTemplate = {
  id: 'issue-resolution',
  name: 'Issue Resolution Document',
  description: 'Template for issue-resolution documentation (INSPECTOR-ONLY)',
  appliesTo: {
    directories: ['content/lost-in-public/issue-resolution/**/*'],
  },
  required: {
    title: { type: 'string', description: 'Title', inspection: requiredStringInspector('title'), defaultValueFn: () => '' },
    lede: { type: 'string', description: 'Brief description', inspection: requiredStringInspector('lede'), defaultValueFn: () => '' },
    date_authored_initial_draft: { type: 'date', description: 'Date of initial draft', inspection: dateInspector('date_authored_initial_draft'), defaultValueFn: () => '' },
    date_authored_current_draft: { type: 'date', description: 'Date of current draft', inspection: dateInspector('date_authored_current_draft'), defaultValueFn: () => '' },
    at_semantic_version: { type: 'string', description: 'Semantic version', inspection: requiredStringInspector('at_semantic_version'), defaultValueFn: () => '' },
    status: { type: 'string', description: 'Status', inspection: requiredStringInspector('status'), defaultValueFn: () => '' },
    augmented_with: { type: 'string', description: 'AI model used', inspection: requiredStringInspector('augmented_with'), defaultValueFn: () => '' },
    category: { type: 'string', description: 'Category', inspection: requiredStringInspector('category'), defaultValueFn: () => '' },
    tags: { type: 'array', description: 'Tags', inspection: requiredArrayInspector('tags'), defaultValueFn: () => [] },
    date_created: { type: 'date', description: 'Creation date', inspection: dateInspector('date_created'), defaultValueFn: () => '' },
    date_modified: { type: 'date', description: 'Last modification date', inspection: dateInspector('date_modified'), defaultValueFn: () => '' },
    site_uuid: { type: 'string', description: 'Unique identifier', inspection: requiredStringInspector('site_uuid'), defaultValueFn: () => '' },
    authors: { type: 'array', description: 'Authors', inspection: requiredArrayInspector('authors'), defaultValueFn: () => [] },
    portrait_image: { type: 'string', description: 'Portrait image URL', inspection: requiredStringInspector('portrait_image'), defaultValueFn: () => '' },
    image_prompt: { type: 'string', description: 'Image prompt for generative tools', inspection: requiredStringInspector('image_prompt'), defaultValueFn: () => '' },
    banner_image: { type: 'string', description: 'Banner image URL', inspection: requiredStringInspector('banner_image'), defaultValueFn: () => '' },
  },
  optional: {
    date_authored_final_draft: { type: 'date', description: 'Date of final draft', inspection: dateInspector('date_authored_final_draft') },
    date_first_published: { type: 'date', description: 'Date of first publication', inspection: dateInspector('date_first_published') },
    date_last_updated: { type: 'date', description: 'Date of last update', inspection: dateInspector('date_last_updated') },
    date_first_run: { type: 'date', description: 'Date first run', inspection: dateInspector('date_first_run') },
    publish: { type: 'boolean', description: 'Publish flag' },
  }
};

export default issueResolutionTemplate;
