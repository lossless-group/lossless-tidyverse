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

// Load environment variables
dotenv.config();

/**
 * Interface for OpenGraph data returned from API.
 * All properties are optional and map directly to Markdown frontmatter keys.
 * If the API response contains a canonical URL, it is mapped as 'og_url'.
 */
interface OpenGraphData {
  image?: string;
  og_url?: string;
  video?: string;
  favicon?: string;
  site_name?: string;
  title?: string;
  description?: string;
  [key: string]: string | undefined;
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

  // --- BEGIN: OpenGraph Field Existence Checks ---
  // Canonical OpenGraph fields for frontmatter
  const ogFields = [
    'image',
    'og_url',
    'video',
    'favicon',
    'site_name',
    'title',
    'description',
    // Add more as needed based on project prompt
  ];

  // Only run OpenGraph API if any of these fields are missing or empty
  const needsOpenGraph = ogFields.some(
    (key) => !updatedFrontmatter[key] || updatedFrontmatter[key].toString().trim() === ''
  );

  // Only run screenshot API if og_screenshot_url is missing or empty
  const needsScreenshot = !updatedFrontmatter.og_screenshot_url || updatedFrontmatter.og_screenshot_url.toString().trim() === '';

  // --- Fetch Screenshot if needed ---
  if (needsScreenshot) {
    fetchScreenshotUrlInBackground(updatedFrontmatter.url || updatedFrontmatter.link, effectiveFilePath!);
  }

  // --- Fetch OpenGraph Data if needed ---
  if (needsOpenGraph) {
    const ogData = await fetchOpenGraphData(updatedFrontmatter.url || updatedFrontmatter.link, effectiveFilePath!);
    if (ogData) {
      // Map OpenGraph fields to frontmatter, always as plain string
      if (ogData.image) {
        updatedFrontmatter.image = ogData.image;
        changed = true;
      }
      if (ogData.og_url) {
        updatedFrontmatter.og_url = ogData.og_url;
        changed = true;
      }
      if (ogData.video) {
        updatedFrontmatter.video = ogData.video;
        changed = true;
      }
      if (ogData.favicon) {
        updatedFrontmatter.favicon = ogData.favicon;
        changed = true;
      }
      if (ogData.site_name) {
        updatedFrontmatter.site_name = ogData.site_name;
        changed = true;
      }
      if (ogData.title) {
        updatedFrontmatter.title = ogData.title;
        changed = true;
      }
      if (ogData.description) {
        updatedFrontmatter.description = ogData.description;
        changed = true;
      }
      updatedFrontmatter.og_last_fetch = new Date().toISOString();
      changed = true;
    }
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
        await updateFileWithScreenshotUrl(filePath, screenshotUrl);
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
 * Updates a file with a screenshot URL in the background
 * @param filePath The path to the file
 * @param screenshotUrl The URL of the screenshot
 */
async function updateFileWithScreenshotUrl(filePath: string, screenshotUrl: string): Promise<void> {
  try {
    // Read file content
    const content = await fs.readFile(filePath, 'utf8');
    
    // Check if file has frontmatter
    if (content.startsWith('---')) {
      // Find the end of frontmatter
      const endIndex = content.indexOf('---', 3);
      if (endIndex !== -1) {
        // Extract frontmatter content
        const frontmatterContent = content.substring(3, endIndex).trim();
        
        try {
          // Parse frontmatter using our custom function
          const { frontmatter } = extractFrontmatterForOpenGraph(content);
          
          if (frontmatter) {
            // Update frontmatter with screenshot URL
            frontmatter.og_screenshot_url = screenshotUrl;
            
            // Format the updated frontmatter using our custom formatter
            const formattedFrontmatter = formatFrontmatter(frontmatter);
            
            // Insert updated frontmatter back into the file
            const newContent = `---\n${formattedFrontmatter}---\n\n${content.substring(endIndex + 3).trimStart()}`;
            await fs.writeFile(filePath, newContent, 'utf8');
            
            console.log(`Updated ${filePath} with screenshot URL in background process`);
          }
        } catch (error) {
          console.error(`Error updating file ${filePath} with screenshot URL:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
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
): Promise<OpenGraphData | null> {
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
      
      // Validate response data
      if (!data.hybridGraph) {
        throw new Error('Invalid API response: missing hybridGraph');
      }
      
      // Extract OpenGraph data
      const ogData: OpenGraphData = {
        image: data.hybridGraph.image || '',
        og_url: data.hybridGraph.url || '',
        video: data.hybridGraph.video || '',
        favicon: data.hybridGraph.favicon || '',
        site_name: data.hybridGraph.site_name || '',
        title: data.hybridGraph.title || '',
        description: data.hybridGraph.description || '',
      };
      
      // Clean up data (remove quotes, etc.)
      for (const key of Object.keys(ogData)) {
        if (typeof ogData[key] === 'string') {
          ogData[key] = ogData[key].replace(/^["']|["']$/g, '');
        }
      }
      
      console.log(`Successfully fetched OpenGraph data for ${url}`);
      return ogData;
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
