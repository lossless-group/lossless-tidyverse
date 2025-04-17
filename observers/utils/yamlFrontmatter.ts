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
    const singleQuoted = `'${value.replace(/'/g, "''")}'`;
    return `${key}: ${singleQuoted}\n`;
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
 * - Uses no quotes if safe (bare string, e.g. for URLs).
 * - Uses single quotes unless the string contains a single quote.
 * - Uses double quotes if the string contains a single quote.
 * - Escapes double quotes if both are present.
 * - Never uses block scalar syntax.
 * @param value The string to assess and quote
 * @returns YAML-safe string with appropriate quoting
 */
export function quoteForYaml(value: string): string {
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
        
        // Handle different value types
        if (value === 'null' || value === '') {
          frontmatter[key] = null;
        } else if (value === 'true') {
          frontmatter[key] = true;
        } else if (value === 'false') {
          frontmatter[key] = false;
        } else if (!isNaN(Number(value)) && !value.startsWith('0')) {
          // Only convert to number if it doesn't start with 0 (to preserve things like versions)
          frontmatter[key] = value.includes('.') ? parseFloat(value) : parseInt(value);
        } else {
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
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
  // Find the end of the original frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return content;
  }

  // Format the frontmatter, using templateOrder if provided
  const formattedFrontmatter = formatFrontmatter(updatedFrontmatter, templateOrder);

  // Extract the body content after the frontmatter
  let bodyContent = content.substring(endIndex + 3);

  // Remove leading whitespace from body content
  bodyContent = bodyContent.replace(/^\s+/, '');

  // Create new content with proper frontmatter and exactly two newlines after it
  return `---\n${formattedFrontmatter}---\n\n${bodyContent}`;
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
