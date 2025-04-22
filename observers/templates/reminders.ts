// =============================================================================
// Inspector-Only Reminders Template for Markdown Frontmatter
//
// This template defines the expected frontmatter structure for reminders files.
// It enforces the INSPECTOR-ONLY pattern as per .windsurfrules:
//   - If a required property does not exist, assert and write with '' (empty string).
//   - If property exists but is '', report as 'empty' but do not treat as error or fix.
//   - If property is malformed, report as 'malformed' but do not enforce or fix.
//   - All inspection results are for reporting only—never for enforcement or hard validation.
//   - All logic here must be idempotent and non-destructive.
//
// See .windsurfrules and issue-resolution docs for project-wide inspector-only policy.
// =============================================================================

import { MetadataTemplate } from '../types/template';
import { generateUUID, getFileCreationDate, getCurrentDate } from '../utils/commonUtils';
import * as path from 'path';

// Inspector function type
/**
 * Inspector functions return an object with keys:
 *   - status: 'ok' | 'empty' | 'malformed' | 'missing'
 *   - message: string (for reporting)
 */
type InspectorResult = { status: 'ok' | 'empty' | 'malformed' | 'missing', message: string };

type InspectorFn = (value: any) => InspectorResult;

// Helper: Inspector for required string fields
function requiredStringInspector(fieldName: string): InspectorFn {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: 'missing', message: `${fieldName} is missing` };
    if (typeof value !== 'string') return { status: 'malformed', message: `${fieldName} is not a string` };
    if (value.trim() === '') return { status: 'empty', message: `${fieldName} is present but empty` };
    return { status: 'ok', message: `${fieldName} is present` };
  };
}

// Helper: Inspector for required array fields
function requiredArrayInspector(fieldName: string): InspectorFn {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: 'missing', message: `${fieldName} is missing` };
    if (!Array.isArray(value)) return { status: 'malformed', message: `${fieldName} is not an array` };
    if (value.length === 0) return { status: 'empty', message: `${fieldName} array is empty` };
    return { status: 'ok', message: `${fieldName} is present` };
  };
}

// Helper: Inspector for date fields (string or null allowed)
function dateInspector(fieldName: string): InspectorFn {
  return (value: any) => {
    if (typeof value === 'undefined') return { status: 'missing', message: `${fieldName} is missing` };
    if (value === null) return { status: 'ok', message: `${fieldName} is null (allowed)` };
    if (typeof value !== 'string') return { status: 'malformed', message: `${fieldName} is not a string` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { status: 'malformed', message: `${fieldName} is not YYYY-MM-DD` };
    return { status: 'ok', message: `${fieldName} is present` };
  };
}

/**
 * Canonical reminders template, inspector-only (never enforcing)
 */
const remindersTemplate: MetadataTemplate = {
  id: 'reminders',
  name: 'Reminders Document',
  description: 'Template for reminders documentation (INSPECTOR-ONLY)',

  appliesTo: {
    directories: ['content/lost-in-public/reminders/**/*'],
  },

  required: {
    title: {
      type: 'string',
      description: 'Title of the reminder',
      inspection: requiredStringInspector('title'),
      defaultValueFn: () => ''
    },
    lede: {
      type: 'string',
      description: 'Brief description of the reminder',
      inspection: requiredStringInspector('lede'),
      defaultValueFn: () => ''
    },
    date_authored_initial_draft: {
      type: 'date',
      description: 'Date of initial draft authoring',
      inspection: dateInspector('date_authored_initial_draft'),
      defaultValueFn: () => ''
    },
    date_authored_current_draft: {
      type: 'date',
      description: 'Date of current draft authoring',
      inspection: dateInspector('date_authored_current_draft'),
      defaultValueFn: () => ''
    },
    at_semantic_version: {
      type: 'string',
      description: 'Semantic version of the reminder',
      inspection: requiredStringInspector('at_semantic_version'),
      defaultValueFn: () => ''
    },
    authors: {
      type: 'array',
      description: 'Author(s) of the reminder',
      inspection: requiredArrayInspector('authors'),
      defaultValueFn: () => []
    },
    status: {
      type: 'string',
      description: 'Current status of the reminder',
      inspection: requiredStringInspector('status'),
      defaultValueFn: () => ''
    },
    augmented_with: {
      type: 'string',
      description: 'AI model used for augmentation',
      inspection: requiredStringInspector('augmented_with'),
      defaultValueFn: () => ''
    },
    category: {
      type: 'string',
      description: 'Category of the reminder',
      inspection: requiredStringInspector('category'),
      defaultValueFn: () => ''
    },
    tags: {
      type: 'array',
      description: 'Categorization tags',
      inspection: requiredArrayInspector('tags'),
      defaultValueFn: () => []
    },
    date_created: {
      type: 'date',
      description: 'Creation date',
      inspection: dateInspector('date_created'),
      defaultValueFn: () => ''
    },
    date_modified: {
      type: 'date',
      description: 'Last modification date',
      inspection: dateInspector('date_modified'),
      defaultValueFn: () => ''
    },
    site_uuid: {
      type: 'string',
      description: 'Unique identifier for the resource on the website',
      inspection: requiredStringInspector('site_uuid'),
      defaultValueFn: () => ''
    },
    // Reminders-specific required fields
    portrait_image: {
      type: 'string',
      description: 'URL for a tall, portrait-oriented image',
      inspection: requiredStringInspector('portrait_image'),
      defaultValueFn: () => ''
    },
    image_prompt: {
      type: 'string',
      description: 'Prompt describing the desired image for generative tools',
      inspection: requiredStringInspector('image_prompt'),
      defaultValueFn: () => ''
    }
  },

  optional: {
    date_authored_final_draft: {
      type: 'date',
      description: 'Date of final draft authoring',
      inspection: dateInspector('date_authored_final_draft')
    },
    date_first_published: {
      type: 'date',
      description: 'Date of first publication',
      inspection: dateInspector('date_first_published')
    },
    date_last_updated: {
      type: 'date',
      description: 'Date of last update',
      inspection: dateInspector('date_last_updated')
    },
    date_first_run: {
      type: 'date',
      description: 'Date the reminder was first run',
      inspection: dateInspector('date_first_run')
    }
  }
};

// Inspector utility: run all inspections and return a report
export function inspectRemindersFrontmatter(frontmatter: Record<string, any>): InspectorResult[] {
  const results: InspectorResult[] = [];
  for (const [field, def] of Object.entries(remindersTemplate.required)) {
    if (typeof def.inspection === 'function') {
      results.push(def.inspection(frontmatter[field]));
    }
  }
  for (const [field, def] of Object.entries(remindersTemplate.optional)) {
    if (typeof def.inspection === 'function' && field in frontmatter) {
      results.push(def.inspection(frontmatter[field]));
    }
  }
  return results;
}

export default remindersTemplate;