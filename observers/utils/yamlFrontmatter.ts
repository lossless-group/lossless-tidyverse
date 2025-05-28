/**
 * YAML Formatter Utility
 * 
 * Provides utilities for formatting YAML frontmatter in a consistent way
 * without adding block scalar syntax or unnecessary quotes.
 * 
 * This is a standalone utility to ensure consistent YAML formatting
 * across the entire observer system.
 */

import { formatDate } from './commonUtils';
import fs from 'fs/promises';
import { ReportingService } from '../services/reportingService';
import { MetadataTemplate, TemplateField } from '../types/template';

/**
 * =============================================================
 * CONDITIONAL RULES FOR RETURNED OBJECTS FROM APIs (Single Source of Truth)
 *
 * These rules apply to any string values (especially from APIs) that are to be written as YAML frontmatter:
 *
 * === RULES ===
 * 1. By default, any url coming back as the single value of a property should be written as a bare continguous string. 
 * 
 * 1. If the string contains any YAML reserved character (:, #, >, |, {, }, [, ], ,, &, *, !, ?, |, -, <, >, =, %, @, `, or quotes), wrap in single quotes ('').
 * 2. If the string contains a single quote ('), wrap in double quotes ("").
 * 3. If the string contains a double quote ("), wrap in single quotes ('').
 * 4. If the string contains both single and double quotes, use double quotes and escape internal double quotes (YAML allows escaping with \").
 * 5. Never use block scalar syntax (|- or >-) for values returned from APIs.
 *
 * These rules are enforced (or should be enforced) in the formatFrontmatterLine function and any helpers.
 *
 * If you update this logic, update this comment block and all relevant helper functions.
 * =============================================================
 */

/**
 * Formats frontmatter as YAML with consistent formatting
 * NEVER uses block scalar syntax (>- or |-) for any values
 * 
 * @param frontmatter The frontmatter object
 * @param templateOrder Optional array of keys to output first
 * @returns Formatted YAML frontmatter
 */
export function formatFrontmatter(frontmatter: Record<string, any>, templateOrder?: string[]): string {
  // Create a copy of the frontmatter to avoid modifying the original
  const formattedFrontmatter = { ...frontmatter };
  
  // Arrays that should be formatted with list syntax (with hyphens)
  const arrayFields = ['tags', 'authors', 'aliases'];
  
  // Extract all array fields that need special formatting
  const extractedArrays: Record<string, any[]> = {};
  
  for (const field of arrayFields) {
    if (formattedFrontmatter[field] && Array.isArray(formattedFrontmatter[field])) {
      extractedArrays[field] = formattedFrontmatter[field];
      delete formattedFrontmatter[field];
    }
  }
  
  let yamlContent = '';
  
  // If a template order is provided, use it to order the keys
  if (templateOrder && Array.isArray(templateOrder)) {
    for (const key of templateOrder) {
      if (key in formattedFrontmatter) {
        yamlContent += formatFrontmatterLine(key, formattedFrontmatter[key]);
        delete formattedFrontmatter[key];
      }
    }
  }
  
  // Output any remaining keys (not in template) in their original order
  for (const [key, value] of Object.entries(formattedFrontmatter)) {
    if (arrayFields.includes(key)) continue;
    
    // Special handling for og_screenshot_url to ensure it's on a single line
    if (key === 'og_screenshot_url' && typeof value === 'string') {
      const cleanedValue = value.trim().replace(/\n/g, '');
      yamlContent += `${key}: '${cleanedValue.replace(/'/g, "''")}'\n`;
      continue;
    }
    
    yamlContent += formatFrontmatterLine(key, value);
  }
  
  // Append each array field in the correct format
  for (const [field, values] of Object.entries(extractedArrays)) {
    yamlContent += `${field}:\n`;
    for (const value of values) {
      yamlContent += `  - ${value}\n`;
    }
  }
  
  return yamlContent;
}

// Helper to format a single line according to project rules
function formatFrontmatterLine(key: string, value: any): string {
  // === Aggressive, Comprehensive, Continuous Commenting ===
  // This function is responsible for formatting a single YAML frontmatter line according to project rules.
  // It now uses the quoteForYaml helper to ensure correct quoting for all string values.
  // All logic for quoting and escaping is delegated to quoteForYaml for DRYness and single source of truth.
  // It also checks for already-quoted strings to prevent double-quoting.

  // Handle date formatting
  if (key.startsWith('date_') && value) {
    const { formatDate } = require('./commonUtils');
    return `${key}: ${formatDate(value)}\n`;
  }
  // Null values
  if (value === null) {
    return `${key}: null\n`;
  }
  // Error message fields (always single-quoted for safety)
  if (
    typeof value === 'string' &&
    (key.endsWith('_error') || key.endsWith('_error_message') || key === 'og_error_message')
  ) {
    // Check if already quoted
    if ((value.startsWith("'") && value.endsWith("'")) || 
        (value.startsWith('"') && value.endsWith('"'))) {
      return `${key}: ${value}\n`;
    }
    const singleQuoted = `'${value.replace(/'/g, "''")}'`;
    return `${key}: ${singleQuoted}\n`;
  }
  // Check for block scalar syntax in strings
  if (typeof value === 'string' && /^\s*[>|][-+0-9]*\s*$/.test(value.trim())) {
    // If it looks like block scalar syntax, quote it immediately
    return `${key}: '${value.replace(/'/g, "''")}'\n`;
  }
  
  // General string handling (use quoteForYaml for all other strings)
  if (typeof value === 'string') {
    return `${key}: ${quoteForYaml(value)}\n`;
  }
  // Fallback for non-string values (numbers, booleans, etc.)
  return `${key}: ${value}\n`;
}

/**
 * Assess a string and return the YAML-safe version, using single or double quotes as needed.
 * - Detects and preserves already-quoted strings
 * - Uses no quotes if safe (bare string, e.g. for URLs).
 * - Uses single quotes unless the string contains a single quote.
 * - Uses double quotes if the string contains a single quote.
 * - Escapes double quotes if both are present.
 * - Never uses block scalar syntax.
 * @param value The string to assess and quote
 * @returns YAML-safe string with appropriate quoting
 */
export function quoteForYaml(value: string): string {
  // First check if the string is already properly quoted
  if ((value.startsWith("'") && value.endsWith("'")) || 
      (value.startsWith('"') && value.endsWith('"'))) {
    // String is already quoted, return as is
    return value;
  }
  
  // Check if this looks like a URL (http:// or https://)
  const isUrl = /^https?:\/\//i.test(value);
  
  // Special handling for URLs to ensure they remain on a single line
  if (isUrl) {
    // Remove any newlines and extra whitespace
    const cleanUrl = value.replace(/\s+/g, ' ').trim();
    // Always quote URLs to be safe, using single quotes unless they contain single quotes
    return cleanUrl.includes("'") ? `"${cleanUrl}"` : `'${cleanUrl}'`;
  }

  // Check for block scalar syntax
  const hasBlockScalar = /^\s*[>|][-+0-9]*\s*$/.test(value.trim());

  // If it's a block scalar, force it to be treated as a regular string
  if (hasBlockScalar) {
    return `'${value.replace(/'/g, "''")}'`; // Single quote the entire thing
  }

  // YAML reserved chars: : # > | { } [ ] , & * ! ? | - < > = % @ ` (and whitespace)
  // Also, whitespace (space, tab, newline) triggers quoting
  const reserved = /[:#>|{}\[\],&*!?|<>=%@`\s]/;
  const hasSingle = value.includes("'");
  const hasDouble = value.includes('"');
  // Needs quoting if it has reserved chars, is empty, or starts with YAML special chars
  const needsQuoting = reserved.test(value) || value === "" || value.startsWith("-") || value.startsWith("?") || value.startsWith(":");

  if (!needsQuoting) {
    // Safe as bare string
    return value;
  }
  if (!hasSingle) {
    // Safe to use single quotes
    return `'${value}'`;
  }
  if (!hasDouble) {
    // Safe to use double quotes
    return `"${value}"`;
  }
  // Contains both single and double quotes: use double quotes and escape double quotes
  return `"${value.replace(/\"/g, '\\"')}"`;
}

/**
 * Extracts frontmatter from markdown content using regex only - no YAML libraries
 * 
 * @param content The markdown content
 * @returns The extracted frontmatter as an object, or null if no frontmatter is found
 */
export function extractFrontmatter(content: string): Record<string, any> | null {
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    return null;
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }
  
  // Extract frontmatter content
  const frontmatterContent = content.substring(3, endIndex).trim();
  
  try {
    // Parse frontmatter using regex, not YAML library
    const frontmatter: Record<string, any> = {};
    
    // Split by lines and process each line
    const lines = frontmatterContent.split('\n');
    
    // Track current array property being processed
    let currentArrayProperty: string | null = null;
    let arrayValues: any[] = [];
    
    // === BEGIN PATCH: Parse flow array syntax for known array fields (tags, authors, aliases) ===
    // This patch ensures that lines like tags: [A, B, C] are parsed as arrays, not as strings.
    // Only applies to known array fields to avoid breaking other logic.
    const ARRAY_FIELDS = ['tags', 'authors', 'aliases'];
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Check if this is an array item
      if (line.startsWith('- ') && currentArrayProperty) {
        // Add to current array
        arrayValues.push(line.substring(2).trim());
        continue;
      }
      
      // If we were processing an array and now hit a new property, save the array
      if (currentArrayProperty && !line.startsWith('- ')) {
        frontmatter[currentArrayProperty] = arrayValues;
        currentArrayProperty = null;
        arrayValues = [];
      }
      
      // Check for key-value pair
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Check if this is the start of an array
        if (!value) {
          currentArrayProperty = key;
          arrayValues = [];
          continue;
        }
        
        // --- PATCHED LOGIC: Detect and parse flow array syntax for known array fields ---
        if (
          ARRAY_FIELDS.includes(key) &&
          typeof value === 'string' &&
          value.trim().startsWith('[') &&
          value.trim().endsWith(']')
        ) {
          // Remove brackets and split by comma
          const inner = value.trim().slice(1, -1);
          // Split, trim, and filter out empty strings
          frontmatter[key] = inner
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x.length > 0);
        } else {
          // Default behavior: assign as string
          // MODIFICATION: Unquote the string value here.
          if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            value = value.substring(1, value.length - 1);
          }
          frontmatter[key] = value;
        }
      }
    }
    
    // Save the last array if we were processing one
    if (currentArrayProperty && arrayValues.length > 0) {
      frontmatter[currentArrayProperty] = arrayValues;
    }
    
    return frontmatter;
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return null;
  }
}

/**
 * Extracts the body content (everything after the YAML frontmatter) from markdown content.
 * 
 * @param content The markdown content.
 * @returns The body content as a string. If no frontmatter is found, returns the original content.
 */
export function extractBodyContent(content: string): string {
  if (!content.startsWith('---')) {
    return content; // No frontmatter detected, return original content
  }
  const endIndex = content.indexOf('---', 3); // Find the second '---'
  if (endIndex === -1) {
    return content; // Malformed frontmatter or no end delimiter, return original content
  }
  // Extract content after the second '---' and trim leading newlines/whitespace
  let body = content.substring(endIndex + 3);
  // Remove up to two leading newline characters, common after frontmatter
  if (body.startsWith('\r\n')) body = body.substring(2);
  else if (body.startsWith('\n')) body = body.substring(1);
  if (body.startsWith('\r\n')) body = body.substring(2);
  else if (body.startsWith('\n')) body = body.substring(1);
  return body;
}

/**
 * Checks if the given content string likely contains YAML frontmatter.
 * It looks for the standard '---' delimiters at the beginning of the content.
 * 
 * @param content The string content to check.
 * @returns True if frontmatter delimiters are found, false otherwise.
 */
export function hasFrontmatter(content: string): boolean {
  // Regex to check for frontmatter delimiters at the start of the string
  // Allows for optional whitespace before the first '---'
  // and requires content between the two '---' blocks.
  const frontmatterRegex = /^\s*---\r?\n([\s\S]+?)\r?\n---/; 
  return frontmatterRegex.test(content);
}

/**
 * Reports basic frontmatter inconsistencies for a Markdown file.
 *
 * @param frontmatter The in-memory frontmatter object to check
 * @param template The template definition object (should have a `required` property)
 * @param filePath The file path for reporting context
 * @returns An object describing only missing or extra fields
 */
export function reportPotentialFrontmatterInconsistencies(
  frontmatter: Record<string, any>,
  template: any, // Should be MetadataTemplate, but using any for flexibility
  filePath: string
): {
  missingFields: string[];
  extraFields: string[];
  filePath: string;
} {
  // === Initialize report object ===
  const report = {
    missingFields: [] as string[],
    extraFields: [] as string[],
    filePath,
  };

  // === Check for missing required fields ===
  for (const key of Object.keys(template.required || {})) {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      report.missingFields.push(key);
    }
  }

  // === Check for extra/unexpected fields ===
  const allowedFields = new Set([
    ...Object.keys(template.required || {}),
    ...Object.keys(template.optional || {}),
  ]);
  for (const key of Object.keys(frontmatter)) {
    if (!allowedFields.has(key)) {
      report.extraFields.push(key);
    }
  }

  return report;
}

/**
 * Applies a template to an existing frontmatter object, adding default values for missing fields.
 *
 * @param currentFrontmatter - The current frontmatter object (can be empty).
 * @param template - The MetadataTemplate to apply.
 * @param autoAddMissingFields - Boolean flag to control automatic addition of missing fields with default values.
 * @param filePath - The path to the file, used by defaultValueFn.
 * @returns An object containing the potentially modified frontmatter and a boolean indicating if changes were made.
 */
export function applyTemplateToFrontmatter(
  currentFrontmatter: Record<string, any>,
  template: MetadataTemplate,
  autoAddMissingFields: boolean,
  filePath: string // For defaultValueFn
): { frontmatter: Record<string, any>; modified: boolean } {
  let modified = false;
  const newFrontmatter = { ...currentFrontmatter };

  const processFields = (fieldSet: { [key: string]: TemplateField }) => {
    for (const key in fieldSet) {
      if (Object.prototype.hasOwnProperty.call(fieldSet, key)) {
        const templateField = fieldSet[key];
        if (!Object.prototype.hasOwnProperty.call(newFrontmatter, key)) {
          if (autoAddMissingFields) {
            if (templateField.defaultValueFn) {
              newFrontmatter[key] = templateField.defaultValueFn(filePath, newFrontmatter);
              modified = true;
            } else if (templateField.defaultValue !== undefined) {
              newFrontmatter[key] = templateField.defaultValue;
              modified = true;
            }
          }
        }
        // Here, you could add validation logic for existing fields if needed in the future
        // For example, checking type or running templateField.validation if present
      }
    }
  };

  processFields(template.required);
  processFields(template.optional);

  return { frontmatter: newFrontmatter, modified };
}

/**
 * Updates the frontmatter in a Markdown file's content string.
 * If a templateOrder is provided, reorders the YAML keys to match the template.
 *
 * @param content The full Markdown file content
 * @param updatedFrontmatter The new frontmatter object
 * @param templateOrder Optional array of keys for ordering
 * @returns The Markdown file content with updated (and possibly reordered) frontmatter
 */
export function updateFrontmatter(content: string, updatedFrontmatter: Record<string, any>, templateOrder?: string[]): string {
  const frontmatterYaml = formatFrontmatter(updatedFrontmatter, templateOrder);
  
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    // If content is empty or doesn't have a frontmatter block, create new content with just the frontmatter.
    // Ensure a newline after the closing '---' for proper formatting.
    return `---
${frontmatterYaml}---
`; // Changed to construct new frontmatter content. Added a trailing newline.
  }
  
  // Find the end of the original frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return content;
  }
  
  // Extract the body content after the frontmatter
  let bodyContent = content.substring(endIndex + 3);
  
  // Remove leading whitespace from body content
  bodyContent = bodyContent.replace(/^\s+/, '');
  
  // Create new content with proper frontmatter and exactly two newlines after it
  return `---\n${frontmatterYaml}---\n\n${bodyContent}`;
}

// === Utility: Remove internal/process-only keys from frontmatter before writing ===
// This ensures keys like 'changed' are never written to disk.
function stripInternalFrontmatterKeys(frontmatter: Record<string, any>): Record<string, any> {
  // Add any additional internal keys here as needed
  const INTERNAL_KEYS = ['changed'];
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!INTERNAL_KEYS.includes(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Writes updated frontmatter (and optionally body) back to a Markdown file.
 * Uses the custom serializer (formatFrontmatter) and updateFrontmatter logic.
 *
 * @param filePath Absolute path to the Markdown file
 * @param updatedFrontmatter The updated frontmatter object
 * @param templateOrder Optional array of keys for ordering
 * @param reportingService Optional instance of ReportingService for logging YAML reorders
 * @returns Promise<void>
 */
export async function writeFrontmatterToFile(
  filePath: string,
  updatedFrontmatter: Record<string, any>,
  templateOrder?: string[],
  reportingService?: ReportingService
): Promise<void> {
  try {
    // Read the existing file content
    const content = await fs.readFile(filePath, 'utf8');
    // Get previous frontmatter order
    const prevFrontmatter = extractFrontmatter(content) || {};
    const previousOrder = Object.keys(prevFrontmatter);
    // Strip internal/process-only keys before writing
    const cleanedFrontmatter = stripInternalFrontmatterKeys(updatedFrontmatter);
    // Use updateFrontmatter to produce new content with cleaned frontmatter and order
    const newContent = updateFrontmatter(content, cleanedFrontmatter, templateOrder);
    // Get new order (after formatting)
    const newOrder = templateOrder && templateOrder.length > 0
      ? [...templateOrder, ...Object.keys(cleanedFrontmatter).filter(k => !templateOrder.includes(k))]
      : Object.keys(cleanedFrontmatter);
    // Compute which fields were actually reordered
    const reorderedFields = previousOrder.filter((key, idx) => newOrder[idx] !== key || previousOrder[idx] !== newOrder[idx]);
    // Write the new content back to the file (atomic write recommended in prod)
    await fs.writeFile(filePath, newContent, 'utf8');
    console.log(`[yamlFrontmatter] Updated frontmatter written to: ${filePath}`);
    // Log YAML reorder event if reportingService is provided and order changed
    if (
      reportingService &&
      previousOrder.length > 0 &&
      JSON.stringify(previousOrder) !== JSON.stringify(newOrder)
    ) {
      reportingService.logFileYamlReorder(filePath, previousOrder, newOrder, reorderedFields);
    }
  } catch (err) {
    console.error(`[yamlFrontmatter] ERROR writing frontmatter to ${filePath}:`, err);
  }
}

/**
 * Example of extracted frontmatter from a Markdown file.
 *
 * This object demonstrates the structure and typical values returned
 * by extractFrontmatter for a real-world Markdown file.
 */
export const exampleExtractedFrontmatter = {
  site_uuid: "d729680e-d296-4c7c-be91-9e08544aea99",
  created_by: "[[organizations/Meta]]",
  github_repo_url: "https://github.com/ollama/ollama",
  github_profile_url: "https://github.com/ollama",
  date_modified: "2025-04-17",
  date_created: "2025-03-31",
  tags: "[Open-Source]",
  url: "https://ollama.com/"
};

// Example for documentation/reference:
// ==============================
// [Observer] File: /Users/mpstaton/code/lossless-monorepo/content/tooling/Enterprise Jobs-to-be-Done/OLlama.md
// [Observer] Extracted frontmatter: {
//   "site_uuid": "d729680e-d296-4c7c-be91-9e08544aea99",
//   "created_by": "[[organizations/Meta]]",
//   "github_repo_url": "https://github.com/ollama/ollama",
//   "github_profile_url": "https://github.com/ollama",
//   "date_modified": "2025-04-17",
//   "date_created": "2025-03-31",
//   "tags": "[Open-Source]",
//   "url": "https://ollama.com/"
// }
// ==============================
