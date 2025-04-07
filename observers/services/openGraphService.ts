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

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';

// Load environment variables
dotenv.config();

/**
 * Interface for OpenGraph data returned from API
 */
interface OpenGraphData {
  og_title: string;
  og_description: string;
  og_image: string;
  og_url: string;
  og_last_fetch: string;
  [key: string]: string; // Index signature to allow string indexing
}

/**
 * Process OpenGraph metadata for a file with frontmatter
 * @param frontmatter The frontmatter object
 * @param filePath The path to the file
 * @returns The updated frontmatter and whether it was changed
 */
export async function processOpenGraphMetadata(
  frontmatter: Record<string, any>,
  filePath: string
): Promise<{ updatedFrontmatter: Record<string, any>; changed: boolean }> {
  // Create a copy of the frontmatter to avoid modifying the original
  const updatedFrontmatter = { ...frontmatter };
  let changed = false;
  
  try {
    // Check if the frontmatter has a URL field
    const url = updatedFrontmatter.url || updatedFrontmatter.link;
    
    if (!url) {
      console.log(`No URL found in frontmatter for ${filePath}`);
      return { updatedFrontmatter, changed };
    }
    
    // Process screenshot URL asynchronously if it doesn't exist
    if (!updatedFrontmatter.og_screenshot_url) {
      // Don't await this promise - let it run in the background
      fetchScreenshotUrlInBackground(url, filePath);
    }
    
    // NEVER process OpenGraph data for files that already have it unless explicitly requested
    if (updatedFrontmatter.og_last_fetch && !updatedFrontmatter.og_refresh_needed) {
      console.log(`Skipping OpenGraph fetch for ${filePath} - already has OpenGraph data and no refresh requested`);
      return { updatedFrontmatter, changed };
    }
    
    // Skip if the file already has OpenGraph metadata and no refresh is needed
    if (
      updatedFrontmatter.og_title && 
      updatedFrontmatter.og_description && 
      updatedFrontmatter.og_image &&
      !updatedFrontmatter.og_refresh_needed
    ) {
      console.log(`OpenGraph metadata already exists for ${filePath}`);
      return { updatedFrontmatter, changed };
    }
    
    // Fetch OpenGraph data
    console.log(`Fetching OpenGraph data for ${url} (${filePath})`);
    const ogData = await fetchOpenGraphData(url, filePath);
    
    if (ogData) {
      // Update frontmatter with OpenGraph data
      updatedFrontmatter.og_title = ogData.og_title;
      updatedFrontmatter.og_description = ogData.og_description;
      updatedFrontmatter.og_image = ogData.og_image;
      updatedFrontmatter.og_url = ogData.og_url;
      updatedFrontmatter.og_last_fetch = ogData.og_last_fetch;
      
      // Remove refresh flag if it exists
      if (updatedFrontmatter.og_refresh_needed) {
        delete updatedFrontmatter.og_refresh_needed;
      }
      
      // Remove error if it exists (since we now have valid data)
      if (updatedFrontmatter.og_error) {
        delete updatedFrontmatter.og_error;
      }
      
      changed = true;
      console.log(`Updated OpenGraph metadata for ${filePath}`);
    } else if (updatedFrontmatter.og_error === undefined) {
      // Only set error if there isn't one already
      updatedFrontmatter.og_error = "Failed to fetch OpenGraph data";
      updatedFrontmatter.og_last_fetch = new Date().toISOString();
      changed = true;
      console.log(`Failed to fetch OpenGraph data for ${filePath}`);
    }
    
    return { updatedFrontmatter, changed };
  } catch (error: unknown) {
    console.error(`Error processing OpenGraph metadata for ${filePath}:`, error);
    
    // Add error information to frontmatter
    updatedFrontmatter.og_error = error instanceof Error ? error.message : "Unknown error fetching OpenGraph data";
    updatedFrontmatter.og_last_fetch = new Date().toISOString();
    changed = true;
    
    return { updatedFrontmatter, changed };
  }
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
      const screenshotUrl = await fetchScreenshotUrl(url, filePath);
      
      if (screenshotUrl) {
        console.log(`✅ Received screenshot URL for ${url} in background process: ${screenshotUrl}`);
        
        // Read the file content
        const content = await fs.readFile(filePath, 'utf8');
        
        // Check if content has frontmatter
        if (!content.startsWith('---')) {
          console.log(`No frontmatter found in ${filePath}, cannot update screenshot URL`);
          return;
        }
        
        // Find the end of frontmatter
        const endIndex = content.indexOf('---', 3);
        if (endIndex === -1) {
          console.log(`Invalid frontmatter format in ${filePath}, cannot update screenshot URL`);
          return;
        }
        
        // Extract frontmatter content
        const frontmatterContent = content.substring(3, endIndex).trim();
        
        try {
          // Parse YAML frontmatter
          const frontmatter = yaml.load(frontmatterContent) as Record<string, any>;
          
          // Update frontmatter with screenshot URL
          frontmatter.og_screenshot_url = screenshotUrl;
          
          // Format the updated frontmatter
          let yamlContent = yaml.dump(frontmatter);
          
          // Insert updated frontmatter back into the file
          const newContent = `---\n${yamlContent}---\n\n${content.substring(endIndex + 3).trimStart()}`;
          await fs.writeFile(filePath, newContent, 'utf8');
          
          console.log(`Updated ${filePath} with screenshot URL in background process`);
        } catch (error) {
          console.error(`Error parsing frontmatter in ${filePath}:`, error);
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
        og_title: data.hybridGraph.title || '',
        og_description: data.hybridGraph.description || '',
        og_image: data.hybridGraph.image || '',
        og_url: data.hybridGraph.url || url,
        og_last_fetch: new Date().toISOString()
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
 * Fetch a screenshot URL for a website
 * @param url The URL to fetch a screenshot for
 * @param filePath The path to the file (for logging)
 * @returns The screenshot URL or null if the fetch failed
 */
export async function fetchScreenshotUrl(
  url: string,
  filePath: string
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
