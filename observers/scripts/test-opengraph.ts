/**
 * Test OpenGraph Integration
 * 
 * This script tests the OpenGraph integration by:
 * 1. Creating test markdown files with URLs
 * 2. Processing the files with the OpenGraph service
 * 3. Testing the asynchronous screenshot URL fetching
 * 4. Logging the results
 * 
 * Usage:
 *   pnpm ts-node scripts/test-opengraph.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { processOpenGraphMetadata, fetchScreenshotUrl } from '../services/openGraphService';
import { ReportingService } from '../services/reportingService';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Check for API key
if (!process.env.OPEN_GRAPH_IO_API_KEY) {
  console.error('Error: OPEN_GRAPH_IO_API_KEY environment variable not set');
  console.error('Please create a .env file in the tidyverse directory with:');
  console.error('OPEN_GRAPH_IO_API_KEY=your_api_key_here');
  process.exit(1);
}

// Initialize reporting service
const reportingService = new ReportingService(path.resolve(__dirname, '../../content/reports'));

/**
 * Create a test markdown file with a URL
 * @param testDir Directory to create the file in
 * @param url URL to include in the frontmatter
 * @param hasExistingData Whether to include existing OpenGraph data
 * @param requestRefresh Whether to request a refresh of OpenGraph data
 * @param hasScreenshotUrl Whether to include an existing screenshot URL
 * @returns Path to the created file
 */
function createTestFile(
  testDir: string, 
  url: string, 
  hasExistingData: boolean = false,
  requestRefresh: boolean = false,
  hasScreenshotUrl: boolean = false
): string {
  // Create test directory if it doesn't exist
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Create test file path
  const filePath = path.join(testDir, `test-opengraph-${Date.now()}.md`);
  
  // Create base frontmatter
  const frontmatter: Record<string, any> = {
    title: 'Test OpenGraph',
    url: url,
    date_created: new Date().toISOString(),
    tags: ['test', 'opengraph']
  };
  
  // Add existing OpenGraph data if specified
  if (hasExistingData) {
    frontmatter.og_title = 'Existing Title';
    frontmatter.og_description = 'Existing description that should not be overwritten';
    frontmatter.og_image = 'https://example.com/image.jpg';
    frontmatter.og_url = url;
    frontmatter.og_last_fetch = new Date().toISOString();
  }
  
  // Add screenshot URL if specified
  if (hasScreenshotUrl) {
    frontmatter.og_screenshot_url = 'https://example.com/screenshot.jpg';
  }
  
  // Add refresh flag if specified
  if (requestRefresh) {
    frontmatter.og_refresh_needed = true;
  }
  
  // Convert frontmatter to YAML
  let yamlFrontmatter = '---\n';
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      yamlFrontmatter += `${key}:\n`;
      for (const item of value) {
        yamlFrontmatter += `  - ${item}\n`;
      }
    } else {
      yamlFrontmatter += `${key}: ${value}\n`;
    }
  }
  yamlFrontmatter += '---\n\n';
  
  // Create test file content
  const content = `${yamlFrontmatter}# Test OpenGraph\n\nThis is a test file for OpenGraph integration.\n`;
  
  // Write test file
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Created test file: ${filePath}`);
  
  return filePath;
}

/**
 * Process a file with OpenGraph metadata
 * @param filePath Path to the file to process
 */
async function processFile(filePath: string): Promise<void> {
  console.log(`Processing file: ${filePath}`);
  
  // Read file content
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    console.error(`No frontmatter found in ${filePath}`);
    return;
  }
  
  // Parse frontmatter
  const frontmatterLines = frontmatterMatch[1].split('\n');
  const frontmatter: Record<string, any> = {};
  
  for (const line of frontmatterLines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Parse key-value pairs
    const match = line.match(/^(\w+):\s*(.*)/);
    if (match) {
      const [, key, value] = match;
      frontmatter[key] = value;
    }
  }
  
  console.log('Original frontmatter:', frontmatter);
  
  // Process OpenGraph metadata
  const result = await processOpenGraphMetadata(frontmatter, filePath);
  
  console.log('OpenGraph processing result:');
  console.log('- Changed:', result.changed);
  console.log('- Updated frontmatter:', result.updatedFrontmatter);
  
  // Update reporting service
  if (result.changed) {
    if (result.updatedFrontmatter.og_error) {
      reportingService.logOpenGraphProcessing(filePath, 'failure');
    } else {
      reportingService.logOpenGraphProcessing(filePath, 'success');
    }
  } else {
    reportingService.logOpenGraphProcessing(filePath, 'skipped');
  }
  
  // Write report
  const reportPath = await reportingService.writeReport();
  if (reportPath) {
    console.log(`Generated report: ${reportPath}`);
  }
}

/**
 * Test screenshot URL fetching directly
 * @param url URL to fetch screenshot for
 * @param filePath Path to the test file (for logging)
 */
async function testScreenshotFetching(url: string, filePath: string): Promise<void> {
  console.log(`\nTesting direct screenshot URL fetching for ${url}`);
  
  try {
    const screenshotUrl = await fetchScreenshotUrl(url, filePath);
    
    if (screenshotUrl) {
      console.log(`✅ Successfully fetched screenshot URL: ${screenshotUrl}`);
      
      // Update the file with the screenshot URL for demonstration
      const content = fs.readFileSync(filePath, 'utf8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      
      if (frontmatterMatch) {
        const frontmatterContent = frontmatterMatch[1];
        const updatedFrontmatter = frontmatterContent.includes('og_screenshot_url:') 
          ? frontmatterContent.replace(/og_screenshot_url:.*/, `og_screenshot_url: ${screenshotUrl}`)
          : `${frontmatterContent}og_screenshot_url: ${screenshotUrl}\n`;
        
        const updatedContent = content.replace(frontmatterMatch[0], `---\n${updatedFrontmatter}---`);
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        console.log(`Updated file with screenshot URL: ${filePath}`);
      }
    } else {
      console.log(`⚠️ No screenshot URL found for ${url}`);
    }
  } catch (error) {
    console.error(`Error fetching screenshot URL for ${url}:`, error);
  }
}

/**
 * Monitor a file for changes to detect background screenshot URL updates
 * @param filePath Path to the file to monitor
 * @param timeout Maximum time to wait in milliseconds
 * @returns Promise that resolves when the file is updated or timeout is reached
 */
async function monitorFileForScreenshotUpdate(filePath: string, timeout: number = 30000): Promise<boolean> {
  console.log(`\nMonitoring ${filePath} for background screenshot URL updates (timeout: ${timeout}ms)`);
  
  // Get initial content
  const initialContent = fs.readFileSync(filePath, 'utf8');
  const startTime = Date.now();
  
  // Check if file already has a screenshot URL
  if (initialContent.includes('og_screenshot_url:')) {
    console.log('File already has a screenshot URL, skipping monitoring');
    return true;
  }
  
  // Monitor file for changes
  return new Promise<boolean>((resolve) => {
    const checkInterval = 2000; // Check every 2 seconds
    
    const intervalId = setInterval(() => {
      // Check if timeout reached
      if (Date.now() - startTime > timeout) {
        clearInterval(intervalId);
        console.log('Timeout reached, no screenshot URL update detected');
        resolve(false);
        return;
      }
      
      // Read current content
      const currentContent = fs.readFileSync(filePath, 'utf8');
      
      // Check if screenshot URL has been added
      if (currentContent.includes('og_screenshot_url:') && !initialContent.includes('og_screenshot_url:')) {
        clearInterval(intervalId);
        console.log('Screenshot URL update detected!');
        
        // Extract the screenshot URL
        const match = currentContent.match(/og_screenshot_url:\s*(.*)/);
        if (match) {
          console.log(`Screenshot URL: ${match[1]}`);
        }
        
        resolve(true);
      }
    }, checkInterval);
  });
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Create test directory
    const testDir = path.resolve(__dirname, '../../content/test-opengraph');
    
    // Test scenarios for OpenGraph metadata
    const scenarios = [
      {
        name: 'New file without OpenGraph data',
        url: 'https://github.com',
        hasExistingData: false,
        requestRefresh: false,
        hasScreenshotUrl: false
      },
      {
        name: 'File with existing OpenGraph data',
        url: 'https://developer.mozilla.org',
        hasExistingData: true,
        requestRefresh: false,
        hasScreenshotUrl: false
      },
      {
        name: 'File with existing OpenGraph data and refresh requested',
        url: 'https://www.typescriptlang.org',
        hasExistingData: true,
        requestRefresh: true,
        hasScreenshotUrl: false
      },
      {
        name: 'File with existing screenshot URL',
        url: 'https://astro.build',
        hasExistingData: true,
        requestRefresh: false,
        hasScreenshotUrl: true
      }
    ];
    
    // Process each scenario
    for (const scenario of scenarios) {
      console.log(`\n=== Testing scenario: ${scenario.name} ===\n`);
      
      // Create test file
      const filePath = createTestFile(
        testDir, 
        scenario.url, 
        scenario.hasExistingData, 
        scenario.requestRefresh,
        scenario.hasScreenshotUrl
      );
      
      // Process file
      await processFile(filePath);
      
      // Wait a bit between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Test direct screenshot URL fetching
    console.log(`\n=== Testing direct screenshot URL fetching ===\n`);
    const screenshotTestFile = createTestFile(testDir, 'https://nodejs.org', false, false, false);
    await testScreenshotFetching('https://nodejs.org', screenshotTestFile);
    
    // Test background screenshot URL fetching
    console.log(`\n=== Testing background screenshot URL fetching ===\n`);
    const backgroundTestFile = createTestFile(testDir, 'https://reactjs.org', false, false, false);
    
    // Process the file first to trigger background screenshot fetching
    await processFile(backgroundTestFile);
    
    // Monitor the file for changes
    const updated = await monitorFileForScreenshotUpdate(backgroundTestFile, 60000); // Wait up to 60 seconds
    
    if (updated) {
      console.log('Background screenshot URL fetching test passed!');
    } else {
      console.log('Background screenshot URL fetching test timed out or failed');
    }
    
    console.log('\nTest completed successfully');
  } catch (error) {
    console.error('Error running test:', error);
  }
}

// Run main function
main().catch(console.error);
