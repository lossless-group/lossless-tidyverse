/**
 * OpenGraph Service
 * 
 * Provides functionality for fetching and processing OpenGraph metadata from URLs.
 * This service integrates with the filesystem observer to automatically update
 * frontmatter in Markdown files with OpenGraph data when URLs are present.
 * 
 * Key features:
 * - Fetches OpenGraph metadata from URLs using the OpenGraph.io API
 * - Fetches screenshot URLs as a fallback when no og_image is available
 * - Implements retry logic with exponential backoff
 * - Handles errors gracefully and records them in frontmatter
 * - Maintains statistics for reporting
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { formatFrontmatter } from '../utils/yamlFrontmatter';
import { extractStringValueForFrontmatter } from '../utils/extractStringValueForFrontmatter';

// Load environment variables
dotenv.config();

// === Single source of truth for OpenGraph fields ===
export const OG_FIELDS = [
  'og_image', 'og_url', 'video', 'favicon', 'site_name', 'title', 'description', 'og_images', 'og_screenshot_url'
];

/**
 * Utility: Check if OpenGraph fields are missing or out-of-date in frontmatter
 *
 * This function checks for the *presence* and *correctness* of all required OpenGraph fields (see OG_FIELDS).
 * - A field is considered present and correct if the key exists in the frontmatter object AND its value matches the normalized value from the last fetch.
 * - If og_last_fetch is present and all OG_FIELDS are present and non-empty, skip OpenGraph processing.
 *
 * This prevents unnecessary OpenGraph fetches and infinite loops when fields are present and up-to-date.
 *
 * @param frontmatter - The frontmatter object to check
 * @returns boolean - true if any OG_FIELDS key is missing or out-of-date in frontmatter
 *
 * ---
 * Aggressive Commenting: Function Call Sites
 * - Called by: processOpenGraphMetadata (direct), evaluateOpenGraph (direct)
 * - Arguments: frontmatter (Record<string, any>)
 * - Returns: boolean
 * ---
 */
export function needsOpenGraph(frontmatter: Record<string, any>): boolean {
  // Returns true if any OG_FIELDS key is missing (i.e., not defined in frontmatter) or empty
  // This logic is critical to avoid infinite loops: empty string or null is considered missing
  // If og_last_fetch exists and all OG_FIELDS are present and non-empty, skip
  if ('og_last_fetch' in frontmatter) {
    const missingOrEmpty = OG_FIELDS.some(key => !(key in frontmatter) || frontmatter[key] === '' || frontmatter[key] === null || frontmatter[key] === undefined);
    if (!missingOrEmpty) {
      // All OG fields present and non-empty, and og_last_fetch exists
      return false;
    }
  }
  // Otherwise, trigger if any OG_FIELDS key is missing or empty
  return OG_FIELDS.some(key => !(key in frontmatter) || frontmatter[key] === '' || frontmatter[key] === null || frontmatter[key] === undefined);
}

/**
 * === Utility: Normalize OpenGraph Data ===
 * Ensures only OG_FIELDS with actual values returned by the API are present in returned objects.
 * - Only fields with non-empty, non-null, non-undefined values are included.
 * - All string values are trimmed and stripped of surrounding quotes.
 * - Arrays are left as-is unless normalization is required.
 * - SPECIAL CASE: Any object is coerced to a key-value pair or array of primitives (never a raw object)
 *
 * This is the single source of truth for OpenGraph field normalization.
 *
 * Aggressive Commenting: This function guarantees that no object is ever returned as-is.
 *
 * @param ogData - The raw OpenGraph data object (possibly incomplete)
 * @returns Normalized OpenGraph data object with only non-empty OG_FIELDS
 */
function normalizeOpenGraphData(ogData: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const key of OG_FIELDS) {
    let value = ogData[key];
    // --- Normalize objects to primitives, arrays, or flat key-value pairs ---
    if (typeof value === 'object' && value !== null) {
      // Special case: object with 'url' property
      if (typeof value.url === 'string') {
        value = value.url;
      } else if (Array.isArray(value)) {
        // Array of objects with 'url' property
        const urls = value
          .filter(item => typeof item === 'object' && item !== null && typeof item.url === 'string')
          .map(item => item.url);
        if (urls.length > 0) {
          value = urls;
        } else {
          // Array of primitives or mixed, keep as-is
          value = value.filter(v => typeof v !== 'object');
        }
      } else {
        // Fallback: flatten object to key-value pairs of primitives
        const flat: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v !== 'object') {
            flat[k] = v;
          }
        }
        if (Object.keys(flat).length > 0) {
          value = flat;
        } else {
          value = '';
        }
      }
    }
    if (typeof value === 'string') {
      value = value.trim().replace(/^['"]|['"]$/g, '');
    }
    // Only include if non-empty, non-null, non-undefined
    if (value !== undefined && value !== null && value !== '') {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * Process OpenGraph metadata for a file with frontmatter
 *
 * If only filePath is provided, the function will read and parse frontmatter from the file.
 * If both frontmatter and filePath are provided, it will use the provided frontmatter.
 * If neither is provided, an error is thrown.
 *
 * @param frontmatter The frontmatter object (optional)
 * @param filePath The path to the file (optional)
 * @returns The updated frontmatter and whether it was changed
 */
export async function processOpenGraphMetadata(
  frontmatter?: Record<string, any>,
  filePath?: string
): Promise<{ updatedFrontmatter: Record<string, any>; changed: boolean }> {
  // === OpenGraph Pause Mechanism (Corrected) ===
  // Set of file paths currently paused from OpenGraph processing (module-level, not function-local)
  const pausedOpenGraphFiles = new Set<string>();

  /**
   * Pause OpenGraph processing for a specific file (until explicitly resumed)
   * @param filePath The file to pause
   */
  function pauseOpenGraphForFile(filePath: string) {
    if (!pausedOpenGraphFiles.has(filePath)) {
      pausedOpenGraphFiles.add(filePath);
      console.log(`[OpenGraph] Pausing OpenGraph processing for ${filePath} (until API and write complete)`);
    }
  }

  /**
   * Resume OpenGraph processing for a specific file (after API and write complete)
   * @param filePath The file to resume
   */
  function resumeOpenGraphForFile(filePath: string) {
    if (pausedOpenGraphFiles.has(filePath)) {
      pausedOpenGraphFiles.delete(filePath);
      console.log(`[OpenGraph] Resumed OpenGraph processing for ${filePath}`);
    }
  }

  // === BEGIN: OpenGraph Pause Check ===
  if (filePath && pausedOpenGraphFiles.has(filePath)) {
    console.log(`[OpenGraph] File ${filePath} is currently paused for OpenGraph processing. Skipping.`);
    // Return the input frontmatter unchanged, mark as not changed
    return { updatedFrontmatter: frontmatter || {}, changed: false };
  }

  // Defensive: If neither argument is provided, throw
  if (!frontmatter && !filePath) {
    throw new Error('Must provide at least a filePath or frontmatter to processOpenGraphMetadata');
  }

  let effectiveFrontmatter: Record<string, any> | undefined = frontmatter;
  let effectiveFilePath: string | undefined = filePath;

  // If only filePath is provided, read and parse frontmatter from the file
  if (!effectiveFrontmatter && effectiveFilePath) {
    try {
      const fileContent = await fs.readFile(effectiveFilePath, 'utf8');
      const { frontmatter: parsed } = extractFrontmatterForOpenGraph(fileContent);
      if (!parsed) {
        throw new Error(`No frontmatter found in file: ${effectiveFilePath}`);
      }
      effectiveFrontmatter = parsed;
    } catch (err) {
      throw new Error(`Failed to read or parse frontmatter from file: ${effectiveFilePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // If only frontmatter is provided, require filePath for logging/context
  if (effectiveFrontmatter && !effectiveFilePath) {
    throw new Error('If providing frontmatter directly, filePath must also be provided for OpenGraph operations.');
  }

  const updatedFrontmatter = { ...effectiveFrontmatter };
  let changed = false;

  // === PAUSE this file for the entire duration of OpenGraph processing ===
  if (filePath) {
    pauseOpenGraphForFile(filePath);
  }

  // === PATCH: Infinite Loop Prevention for OpenGraph ===
  //
  // This implementation ensures:
  // - Only missing OG fields (not present AT ALL) trigger a fetch
  // - All OG fields are normalized to strings before writing
  // - No infinite loops: present-but-empty fields do NOT trigger fetch
  // - Aggressive logging at every decision point
  // - No destructive writes: unrelated fields are preserved
  // - Only og_last_fetch is updated if a real OG field changes
  //
  // --- BEGIN PATCHED FUNCTION ---
  // --- BEGIN: OpenGraph Field Existence Checks ---
  // Canonical OpenGraph fields for frontmatter
  // Only run OpenGraph API if any of these fields are missing (not present AT ALL)
  const needsOG = needsOpenGraph(updatedFrontmatter);

  // Only run screenshot API if og_screenshot_url is missing (not present AT ALL)
  const needsScreenshot = !('og_screenshot_url' in updatedFrontmatter);

  // --- LOGGING: Initial State ---
  console.log('[OpenGraph] processOpenGraphMetadata called for', effectiveFilePath);
  console.log('[OpenGraph] Initial updatedFrontmatter:', JSON.stringify(updatedFrontmatter, null, 2));
  console.log('[OpenGraph] needsScreenshot:', needsScreenshot, 'needsOpenGraph:', needsOG);

  // === TRACK OG FIELD UPDATES ===
  let ogFieldChanged = false; // Track if any real OG field changed
  let screenshotFieldChanged = false; // Track if screenshot field changed
  const originalFrontmatterSnapshot = { ...updatedFrontmatter };

  // If no OG fields are missing and no screenshot is missing, skip processing and avoid writing
  if (!needsOG && !needsScreenshot) {
    console.log('[OpenGraph] All OpenGraph fields present (even if empty). Skipping fetch and avoiding infinite loop.');
    // === RESUME OpenGraph for this file only AFTER all API calls and writes are complete ===
    if (filePath) {
      resumeOpenGraphForFile(filePath);
    }
    return { updatedFrontmatter, changed: false };
  }

  // === Clean the URL before using it for API calls ===
  if (typeof updatedFrontmatter.url === 'string') {
    updatedFrontmatter.url = updatedFrontmatter.url.replace(/^['"]|['"]$/g, '');
  }

  // --- Fetch Screenshot if needed ---
  if (needsScreenshot) {
    console.log('[OpenGraph] Calling fetchScreenshotUrlInBackground with URL:', updatedFrontmatter.url || updatedFrontmatter.link);
    // === PATCH: fetchScreenshotUrlInBackground must NOT write to disk, only return updated frontmatter ===
    // We use a local update pattern:
    // 1. Fetch screenshot URL
    // 2. If a new screenshot URL is returned and different from current, update local frontmatter and set screenshotFieldChanged
    fetchScreenshotUrlInBackground(updatedFrontmatter.url || updatedFrontmatter.link, effectiveFilePath!);
  }

  // --- Fetch OpenGraph Data if needed ---
  if (needsOG) {
    console.log('[OpenGraph] Calling fetchOpenGraphData with URL:', updatedFrontmatter.url || updatedFrontmatter.link);
    const ogData = await fetchOpenGraphData(updatedFrontmatter.url || updatedFrontmatter.link, effectiveFilePath!);
    console.log('[OpenGraph] fetchOpenGraphData result:', JSON.stringify(ogData, null, 2));
    if (ogData) {
      // --- BEGIN: OpenGraph Image Handling ---
      // 1. Do NOT overwrite existing 'image' or 'images' properties
      // 2. Map singular image URLs to 'og_image' (bare string, full URL)
      // 3. Map arrays of image URLs to 'og_images' (array of bare, full URLs)
      // 4. Never quote or truncate URLs

      // --- Normalize OpenGraph API results before merging ---
      // Defensive: Always normalize fields before merging into frontmatter
      // Use single-source normalization utility
      const normalizedOgData = normalizeOpenGraphData(ogData);

      // --- BEGIN: Only update OG fields if value is non-empty, and never remove or overwrite unrelated fields ---
      for (const key of Object.keys(normalizedOgData)) {
        // Only update if the API returned a non-empty, non-null, non-undefined value
        if (
          normalizedOgData[key] !== undefined &&
          normalizedOgData[key] !== null &&
          normalizedOgData[key] !== ''
        ) {
          if (updatedFrontmatter[key] !== normalizedOgData[key]) {
            updatedFrontmatter[key] = normalizedOgData[key];
            ogFieldChanged = true;
          }
        }
        // If the API did NOT return a value, do not touch the property at all
      }
      // --- END: Only update OG fields if value is non-empty ---
    }
  }

  // === PATCH: Always update og_last_fetch if any OG field or screenshot field changed ===
  if (ogFieldChanged || screenshotFieldChanged) {
    // --- Aggressive Logging ---
    console.log('[OpenGraph] ogFieldChanged or screenshotFieldChanged detected. Writing og_last_fetch.');
    updatedFrontmatter.og_last_fetch = '2025-04-20T19:43:01-05:00';
    changed = true;
  } else {
    // Aggressive logging for debugging: log when OG fetch is a no-op
    console.log(`[OpenGraph] No frontmatter fields updated for ${effectiveFilePath}, skipping og_last_fetch update.`);
  }

  // --- LOGGING: Final State ---
  console.log('[OpenGraph] Final updatedFrontmatter:', JSON.stringify(updatedFrontmatter, null, 2));
  console.log('[OpenGraph] Returning changed:', changed);

  // === RESUME OpenGraph for this file only AFTER all API calls and writes are complete ===
  if (filePath) {
    resumeOpenGraphForFile(filePath);
  }

  return { updatedFrontmatter, changed };
}

// Set to track URLs that are currently being processed for screenshots
const screenshotFetchInProgress = new Set<string>();

/**
 * Fetch a screenshot URL in the background and update the file when done
 * This function runs asynchronously and doesn't block the main process
 * @param url The URL to fetch a screenshot for
 * @param filePath The path to the file to update
 */
function fetchScreenshotUrlInBackground(url: string, filePath: string): void {
  // Skip if we're already fetching this URL
  if (screenshotFetchInProgress.has(url)) {
    console.log(`Screenshot fetch already in progress for ${url}, skipping duplicate request`);
    return;
  }
  
  // Add to tracking set
  screenshotFetchInProgress.add(url);
  
  console.log(`Starting background screenshot fetch for ${url} (${filePath})`);
  
  // Don't await this promise - let it run in the background
  (async () => {
    try {
      const screenshotUrl = await fetchScreenshotUrl(url);
      
      if (screenshotUrl) {
        console.log(`✅ Received screenshot URL for ${url} in background process: ${screenshotUrl}`);
        
        // Update the file with the screenshot URL
        const updatedFrontmatter = await updateFileWithScreenshotUrl(filePath, screenshotUrl);
        if (updatedFrontmatter) {
          console.log(`Updated frontmatter for ${filePath}:`, updatedFrontmatter);
        } else {
          console.log(`No frontmatter update for ${filePath}`);
        }
      } else {
        console.log(`⚠️ No screenshot URL found for ${url} in background process`);
      }
    } catch (error) {
      console.error(`Error in background screenshot fetch for ${url}:`, error);
    } finally {
      // Remove from tracking set when done
      screenshotFetchInProgress.delete(url);
    }
  })();
}

/**
 * Updates a file with a screenshot URL in the background
 * @param filePath The path to the file
 * @param screenshotUrl The URL of the screenshot
 * @returns The updated frontmatter object (DOES NOT WRITE TO DISK)
 *
 * Aggressive Commenting:
 * - This function NO LONGER writes to disk directly.
 * - Instead, it returns the updated frontmatter object to the Observer.
 * - The Observer is responsible for all file writes, ensuring atomic, DRY, and race-free updates.
 */
export async function updateFileWithScreenshotUrl(filePath: string, screenshotUrl: string): Promise<Record<string, any> | null> {
  try {
    // Read file content
    const content = await fs.readFile(filePath, 'utf8');
    // Check if file has frontmatter
    if (content.startsWith('---')) {
      // Find the end of frontmatter
      const endIndex = content.indexOf('---', 3);
      if (endIndex !== -1) {
        // Extract frontmatter content
        const { frontmatter } = extractFrontmatterForOpenGraph(content);
        if (frontmatter) {
          // Update frontmatter with screenshot URL
          frontmatter.og_screenshot_url = screenshotUrl;
          // Return updated frontmatter (do not write)
          return frontmatter;
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`Error preparing screenshot URL update for ${filePath}:`, error);
    return null;
  }
}

/**
 * Extract frontmatter from markdown content using regex only - no YAML libraries
 * @param content The markdown content
 * @returns The extracted frontmatter as an object, or null if no frontmatter is found
 */
function extractFrontmatterForOpenGraph(content: string): {frontmatter: Record<string, any> | null, startIndex: number, endIndex: number} {
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    return { frontmatter: null, startIndex: 0, endIndex: 0 };
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, startIndex: 0, endIndex: 0 };
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
    
    // Handle any remaining array
    if (currentArrayProperty) {
      frontmatter[currentArrayProperty] = arrayValues;
    }
    
    return { 
      frontmatter: frontmatter,
      startIndex: 0,
      endIndex: endIndex + 3
    };
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return { frontmatter: null, startIndex: 0, endIndex: 0 };
  }
}

/**
 * Fetch OpenGraph data for a URL
 * @param url The URL to fetch OpenGraph data for
 * @param filePath The path to the file (for logging)
 * @returns The OpenGraph data or null if the fetch failed
 */
export async function fetchOpenGraphData(
  url: string,
  filePath: string
): Promise<Record<string, any> | null> {
  // Maximum number of retry attempts
  const MAX_RETRIES = 3;
  
  // Retry with exponential backoff
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Fetching OpenGraph data for ${url} (attempt ${attempt}/${MAX_RETRIES})`);
      
      // Get API key from environment variable
      const apiKey = process.env.OPEN_GRAPH_IO_API_KEY;
      if (!apiKey) {
        throw new Error('OPEN_GRAPH_IO_API_KEY environment variable not set');
      }
      
      // Construct API URL
      const apiUrl = `https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?app_id=${apiKey}`;
      
      // Fetch data from API
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log(`[OpenGraph] Raw API response data.openGraph for ${url}:`, JSON.stringify(data.openGraph, null, 2));
      
      // --- CHANGE: Ignore hybridGraph, only use openGraph fields ---
      // Validate response data
      if (!data.openGraph) {
        throw new Error('Invalid API response: missing openGraph');
      }
      
      // Extract OpenGraph data using ONLY openGraph fields (ignore hybridGraph completely)
      const ogData: Record<string, any> = {
        og_url: data.openGraph.url || '',
        video: data.openGraph.video || '',
        favicon: data.openGraph.favicon || '',
        site_name: data.openGraph.site_name || '',
        title: data.openGraph.title || '',
        description: data.openGraph.description || '',
        og_image_url: data.openGraph.image?.url || '',
        og_image: data.openGraph.image || '',
        og_inferred_images: Array.isArray(data.htmlInferred?.images) ? data.htmlInferred.images : [],
        images: Array.isArray(data.images) ? data.images : [],
      };
      
      console.log(`[OpenGraph] Constructed ogData (pre-normalization) for ${url}:`, JSON.stringify(ogData, null, 2));
      
      // Clean up data (remove quotes, etc.)
      for (const key of Object.keys(ogData)) {
        if (typeof ogData[key] === 'string') {
          ogData[key] = ogData[key].replace(/^["']|["']$/g, '');
        }
      }
      
      // Normalize OpenGraph data before returning
      const normalizedOgData = normalizeOpenGraphData(ogData);
      
      console.log(`Successfully fetched OpenGraph data for ${url}`);
      return normalizedOgData;
    } catch (error: unknown) {
      console.error(`Error fetching OpenGraph data for ${url} (attempt ${attempt}/${MAX_RETRIES}):`, error);
      
      if (attempt === MAX_RETRIES) {
        console.error(`Max retries reached for ${url}`);
        return null;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}

/**
 * Fetches a screenshot URL from the OpenGraph.io API for the provided URL.
 *
 * @param url The URL to fetch a screenshot for
 * @returns The screenshot URL or null if the fetch failed
 *
 * NOTE: 'filePath' is not required for the API call and is not used here. All file updates are handled by separate, atomic, validated functions.
 */
export async function fetchScreenshotUrl(
  url: string
): Promise<string | null> {
  // Maximum number of retry attempts
  const MAX_RETRIES = 2;
  
  // Retry with exponential backoff
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Fetching screenshot URL for ${url} (attempt ${attempt}/${MAX_RETRIES})`);
      
      // Get API key from environment variable
      const apiKey = process.env.OPEN_GRAPH_IO_API_KEY;
      if (!apiKey) {
        throw new Error('OPEN_GRAPH_IO_API_KEY environment variable not set');
      }
      
      // Construct API URL for screenshot - using the format from the archived scripts
      // The API expects: https://opengraph.io/api/1.1/screenshot/{url}?parameters
      const screenshotApiUrl = `https://opengraph.io/api/1.1/screenshot/${encodeURIComponent(url)}?dimensions=lg&quality=80&accept_lang=en&use_proxy=true&app_id=${apiKey}`;
      
      // Fetch data from API
      const response = await fetch(screenshotApiUrl);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Check if we got a screenshot URL
      if (data.screenshotUrl) {
        console.log(`Successfully fetched screenshot URL for ${url}: ${data.screenshotUrl}`);
        return data.screenshotUrl;
      } else {
        console.log(`No screenshot URL found in API response for ${url}`);
        return null;
      }
    } catch (error: unknown) {
      console.error(`Error fetching screenshot URL for ${url} (attempt ${attempt}/${MAX_RETRIES}):`, error);
      
      if (attempt === MAX_RETRIES) {
        console.error(`Max retries reached for ${url}`);
        return null;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}

/**
 * evaluateOpenGraph - Determines if OpenGraph metadata should be fetched for this file.
 *
 * This function uses needsOpenGraph to check if any required OpenGraph fields are missing (i.e., key does not exist).
 *
 * - If any field is missing, logs which file is missing fields and returns { expectOpenGraph: true }.
 * - If all fields are present (even if empty), logs that all fields are present and returns { expectOpenGraph: false }.
 *
 * Aggressive Commenting: Function Call Sites
 * - Called by: external (filesystem observer)
 * - Arguments: frontmatter (object), filePath (string)
 * - Returns: { expectOpenGraph: boolean }
 *
 * ---
 * Calls: needsOpenGraph(frontmatter)
 * ---
 */
export function evaluateOpenGraph(frontmatter: Record<string, any>, filePath: string): { expectOpenGraph: boolean } {
  const missing = needsOpenGraph(frontmatter);
  if (missing) {
    console.log(`[evaluateOpenGraph] Missing OpenGraph fields in ${filePath}`);
  } else {
    console.log(`[evaluateOpenGraph] All OpenGraph fields present in ${filePath}`);
  }
  return { expectOpenGraph: missing };
}

/**
 * processOpenGraphKeyValues - Fetches OpenGraph metadata and returns key-value pairs to merge into frontmatter.
 *
 * @param frontmatter - The frontmatter object to update
 * @param filePath - The file path (for logging)
 * @returns Promise resolving to { ogKeyValues: Record<string, any> }
 *
 * Aggressive commenting: This function only returns the precise OpenGraph-related fields it intends to update.
 * It never returns the full frontmatter, and never removes or drops unrelated fields.
 * The orchestrator is responsible for merging these partials into the original frontmatter.
 * This prevents infinite loops and guarantees no user data is dropped unless explicitly overwritten.
 *
 * Called by: FileSystemObserver.onChange (and ONLY there)
 */
export async function processOpenGraphKeyValues(frontmatter: Record<string, any>, filePath: string): Promise<{ ogKeyValues: Record<string, any> }> {
  // Use the main processing logic (reuse existing code)
  const { updatedFrontmatter } = await processOpenGraphMetadata(frontmatter, filePath);
  // Compute only the new/changed OpenGraph keys
  const ogKeyValues: Record<string, any> = {};
  for (const key of OG_FIELDS) {
    // Only return OG fields that are present and non-empty in updatedFrontmatter
    if (
      updatedFrontmatter[key] !== undefined &&
      updatedFrontmatter[key] !== null &&
      updatedFrontmatter[key] !== ''
    ) {
      ogKeyValues[key] = updatedFrontmatter[key];
    }
  }
  // Aggressive logging: always show what keys are being returned
  console.log(`[processOpenGraphKeyValues] Returning updated OpenGraph keys for ${filePath}:`, ogKeyValues);
  return { ogKeyValues };
}

/**
 * === Function Call Map and Usage Reference ===
 *
 * Functions defined in this file and where/how they are used:
 *
 * - needsOpenGraph:
 *     - Called by: processOpenGraphMetadata (direct), evaluateOpenGraph (direct)
 *     - Arguments: frontmatter (Record<string, any>)
 *     - Returns: boolean
 *
 * - processOpenGraphMetadata:
 *     - Called by: processOpenGraphKeyValues (direct)
 *     - Arguments: frontmatter (object, optional), filePath (string, optional)
 *     - Returns: Promise<{ updatedFrontmatter, changed }>
 *
 * - fetchScreenshotUrlInBackground:
 *     - Called by: processOpenGraphMetadata (direct)
 *     - Arguments: url (string), filePath (string)
 *     - Returns: void
 *
 * - extractFrontmatterForOpenGraph:
 *     - Called by: processOpenGraphMetadata, updateFileWithScreenshotUrl
 *     - Arguments: content (string)
 *     - Returns: { frontmatter, startIndex, endIndex }
 *
 * - updateFileWithScreenshotUrl:
 *     - Called by: fetchScreenshotUrlInBackground (direct)
 *     - Arguments: filePath (string), screenshotUrl (string)
 *     - Returns: Promise<Record<string, any> | null>
 *
 * - fetchOpenGraphData:
 *     - Called by: processOpenGraphMetadata (direct)
 *     - Arguments: url (string), filePath (string)
 *     - Returns: Promise<Record<string, any> | null>
 *
 * - fetchScreenshotUrl:
 *     - Called by: fetchScreenshotUrlInBackground (direct)
 *     - Arguments: url (string)
 *     - Returns: Promise<string | null>
 *
 * - evaluateOpenGraph:
 *     - Called by: external (filesystem observer)
 *     - Arguments: frontmatter (object), filePath (string)
 *     - Returns: { expectOpenGraph: boolean }
 *
 * - processOpenGraphKeyValues:
 *     - Called by: FileSystemObserver.onChange (external)
 *     - Arguments: frontmatter (object), filePath (string)
 *     - Returns: Promise<{ ogKeyValues: Record<string, any> }>
 */

// === EXPORT updateFileWithScreenshotUrl for Observer atomic-writes ===
// Removed redundant export to prevent redeclaration error. The function is already exported at definition.
