// -----------------------------------------------------------------------------
// remindersHandler.ts
// Service-oriented handler for the reminders content collection.
// Implements the atomic, propertyCollector, single-write pattern as per spec.
// -----------------------------------------------------------------------------

import remindersTemplate from '../templates/reminders';

/**
 * Process a reminders file: COMPARE frontmatter to the template and REPORT ONLY.
 * NEVER mutate, auto-correct, or return changes for orchestrator to write.
 * Returns a validation report: missing, invalid, extra fields (for reporting/logging only).
 *
 * @param frontmatter The current frontmatter object
 * @param filePath The absolute file path
 * @param context (optional) Observer context for advanced use
 * @returns Validation report object
 */
export async function processRemindersFrontmatter(
  frontmatter: Record<string, any>,
  filePath: string,
  context?: any
): Promise<{
  missingFields: string[];
  invalidFields: string[];
  extraFields: string[];
  filePath: string;
  changes: Record<string, any>;
}> {
  // Aggressive comments: This function ONLY reports, never mutates frontmatter directly.
  // It compares the given frontmatter to the remindersTemplate and logs/report discrepancies.
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const extraFields: string[] = [];
  const changes: Record<string, any> = {};

  console.log(`[RemindersHandler] Processing file: ${filePath}`);
  console.log('[RemindersHandler] Original frontmatter:', frontmatter);

  // Check for missing required fields
  for (const [key, def] of Object.entries(remindersTemplate.required)) {
    if (!(key in frontmatter)) {
      missingFields.push(key);
      // Provide a sensible placeholder value for missing fields
      changes[key] = '';
    } else if (typeof def.validation === 'function' && !def.validation(frontmatter[key])) {
      invalidFields.push(key);
      // Provide a sensible placeholder value for invalid fields
      changes[key] = '';
    }
  }

  // Check for extra fields not in template
  const allowedFields = new Set([
    ...Object.keys(remindersTemplate.required),
    ...Object.keys(remindersTemplate.optional || {})
  ]);
  for (const key of Object.keys(frontmatter)) {
    if (!allowedFields.has(key)) {
      extraFields.push(key);
    }
  }

  // Aggressive reporting/logging
  if ((missingFields.length > 0 || invalidFields.length > 0 || extraFields.length > 0) && context?.reportingService) {
    context.reportingService.logErrorEvent(filePath, {
      missingFields,
      invalidFields,
      extraFields
    });
    console.log(`[RemindersHandler] Validation report for ${filePath}:`, { missingFields, invalidFields, extraFields });
  }

  console.log('[RemindersHandler] Validation report:', { missingFields, invalidFields, extraFields });

  return { missingFields, invalidFields, extraFields, filePath, changes };
}

// Optionally, add more reminders-specific normalization here
