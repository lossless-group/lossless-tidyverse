/**
 * Utility function for robustly extracting a value from any API response field for frontmatter.
 * Handles strings, numbers, booleans, arrays (including OpenGraph image URL lists), objects with `.url`, and logs unexpected types for debugging.
 *
 * SPECIAL CASE: OpenGraph API sometimes returns a list of image URLs (e.g., images: ["url1", "url2", ...]).
 * THIS FUNCTION NOW PRESERVES ARRAYS: If the value is an array of strings, numbers, or booleans, it is returned as an array (not joined).
 * If the value is an array of objects with `.url`, returns an array of URLs.
 *
 * This function is the single source of truth for normalizing API data before
 * merging into frontmatter or performing presence checks in observer logic.
 *
 * @param fieldValue - The value received from an API (could be any type)
 * @returns The extracted value, suitable for frontmatter (string, array, or empty string/array)
 */
export function extractStringValueForFrontmatter(fieldValue: unknown): string | string[] | number | number[] | boolean | boolean[] | '' | [] {
  // === Handle null and undefined ===
  if (fieldValue === undefined || fieldValue === null) {
    // COMMENT: null/undefined normalized to empty string
    return '';
  }

  // === Handle strings ===
  if (typeof fieldValue === 'string') {
    // COMMENT: String is returned as-is
    return fieldValue;
  }

  // === Handle numbers and booleans ===
  if (typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
    // COMMENT: Convert number/boolean to itself (preserve type)
    return fieldValue;
  }

  // === Handle arrays ===
  if (Array.isArray(fieldValue)) {
    // COMMENT: Array handling for OpenGraph and similar APIs
    // If all elements are strings, return as array of strings
    if (fieldValue.every((el) => typeof el === 'string')) {
      return fieldValue as string[];
    }
    // If all elements are numbers, return as array of numbers
    if (fieldValue.every((el) => typeof el === 'number')) {
      return fieldValue as number[];
    }
    // If all elements are booleans, return as array of booleans
    if (fieldValue.every((el) => typeof el === 'boolean')) {
      return fieldValue as boolean[];
    }
    // If all elements are objects with a .url property, extract and return array of URLs
    if (fieldValue.every((el) => typeof el === 'object' && el !== null && 'url' in el && typeof (el as any).url === 'string')) {
      return fieldValue.map((el) => (el as any).url);
    }
    // Mixed or unsupported array types: log warning, return empty array
    console.warn('[extractStringValueForFrontmatter] Unsupported array type:', fieldValue);
    return [];
  }

  // === Handle objects (excluding arrays) ===
  if (typeof fieldValue === 'object') {
    // COMMENT: If object has a .url property, return it
    if ('url' in fieldValue && typeof (fieldValue as any).url === 'string') {
      return (fieldValue as any).url;
    }
    // COMMENT: If object is Date, convert to ISO string
    if (fieldValue instanceof Date) {
      return fieldValue.toISOString();
    }
    // COMMENT: For plain objects, log and return empty string
    console.warn('[extractStringValueForFrontmatter] Unsupported object type:', fieldValue);
    return '';
  }

  // === Fallback: log and return empty string for unknown types ===
  console.warn('[extractStringValueForFrontmatter] Unexpected API field type:', fieldValue);
  return '';
}

/**
 * List of all files and functions that should use this utility:
 * - All observer/service logic that merges API data into frontmatter
 * - All presence checks for frontmatter fields (e.g., og_image, favicon, etc.)
 * - See: tidyverse/observers/services/openGraphService.ts
 * - See: tidyverse/observers/fileSystemObserver.ts
 */

/**
 * USAGE MANIFEST: Functions and files that must use this utility
 *
 * 1. All observer/service logic that merges API data into frontmatter
 *    - e.g., OpenGraph, Screenshot, and similar enrichment logic
 * 2. All presence checks for frontmatter fields (e.g., og_image, favicon, etc.)
 * 3. See: tidyverse/observers/services/openGraphService.ts
 * 4. See: tidyverse/observers/fileSystemObserver.ts
 * 5. Any future API enrichment or observer logic
 *
 * Always import and use this function for normalization and presence checks.
 */
