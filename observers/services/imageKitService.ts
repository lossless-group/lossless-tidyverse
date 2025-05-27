import ImageKit from 'imagekit';
import fetch from 'node-fetch';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ImageKitConfig } from '../userOptionsConfig';

interface Progress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
}

export class ImageKitService extends EventEmitter {
  private processedUrls = new Set<string>();
  private uploadQueue: Array<{
    filePath: string;
    imageUrl: string;
    attempt: number;
  }> = [];
  private progress: Progress = {
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: []
  };
  private config: ImageKitConfig;

  constructor(config: ImageKitConfig) {
    super();
    this.config = config;
  }

  /**
   * Process screenshots and return the ImageKit URL
   * @param filePath Path to the file being processed (for logging only)
   * @param frontmatter The frontmatter object containing the URL to process (will not be modified)
   * @returns The ImageKit URL if successful, null otherwise
   */
  async processScreenshots(filePath: string, frontmatter: any): Promise<string | null> {
    // Create a copy of the frontmatter to avoid modifying the original
    const frontmatterCopy = JSON.parse(JSON.stringify(frontmatter));
    
    // Create the toolkit-screenshots directory if it doesn't exist
    const screenshotsDir = '/Users/mpstaton/code/lossless-monorepo/toolkit-screenshots';
    await fs.mkdir(screenshotsDir, { recursive: true });
    
    try {
      // Skip if service is disabled
      if (!this.config.enabled) {
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] Service is disabled, skipping ${filePath}`);
        }
        return null;
      }

      // Get the target URL from frontmatter (using url or open_graph_url)
      const targetUrl = frontmatter.url
      
      // Skip if no target URL found
      if (!targetUrl) {
        console.log(`[ImageKit] No target URL found in frontmatter for ${filePath}`);
        return null;
      }

      // Skip if we already have an ImageKit URL and overwrite is disabled
      if (frontmatter.og_screenshot_url && !this.config.overwriteScreenshotUrl) {
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] ImageKit URL exists and overwrite is disabled for ${filePath}`);
        }
        return null; // Return null to indicate no change needed
      }
      
      // Skip if no target URL found
      if (!targetUrl) {
        console.log(`[ImageKit] No target URL found in frontmatter for ${filePath}`);
        return null;
      }
      
      console.log(`[ImageKit] Generating new screenshot for ${targetUrl}`);
      
      // Add a 6-second delay between requests to prevent rate limiting
      console.log('[ImageKit] Waiting 6 seconds before next request...');
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      // Generate a new screenshot URL using the OpenGraph API
      const screenshotUrl = await this.generateScreenshotUrl(targetUrl);
      
      if (!screenshotUrl) {
        console.error(`[ImageKit] Failed to generate screenshot URL for ${targetUrl}`);
        return null;
      }
      
      // Generate a filename for the screenshot
      const filename = `${path.basename(filePath, path.extname(filePath))}_og_screenshot.jpeg`;
      const localScreenshotPath = path.join(screenshotsDir, filename);
      
      // Download the newly generated screenshot
      console.log(`[ImageKit] Downloading new screenshot from ${screenshotUrl}`);
      await this.downloadFile(screenshotUrl, localScreenshotPath);
      
      // Verify the file was downloaded
      try {
        await fs.access(localScreenshotPath);
      } catch (error) {
        throw new Error(`Failed to verify downloaded screenshot at ${localScreenshotPath}`);
      }

      // Update progress
      this.progress.total++;
      this.emit('progress', { ...this.progress });

      // Upload the downloaded screenshot to ImageKit
      const imageKitUrl = await this.uploadImageToImageKitWithRetry(filePath, localScreenshotPath);
      
      // Keep the downloaded files for debugging purposes
      console.log(`[ImageKit] Kept downloaded file at: ${localScreenshotPath}`);
      
      if (imageKitUrl) {
        // Update progress on success
        this.progress.succeeded++;
        this.progress.processed++;
        this.emit('progress', { ...this.progress });
        
        // Log success
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] Successfully processed screenshot for ${filePath}`);
        }
        
        return imageKitUrl;
      } else {
        // Handle upload failure after retries
        const errorMsg = 'Failed to upload screenshot after retries';
        this.progress.failed++;
        this.progress.errors.push({
          file: filePath,
          error: errorMsg
        });
        this.progress.processed++;
        this.emit('progress', { ...this.progress });
        
        // Log the error
        const shouldLogError = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.error);
        if (shouldLogError) {
          console.error(`[ImageKit] ${errorMsg} for ${filePath}`);
        }
        
        return null;
      }
    } catch (error) {
      // Handle unexpected errors
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.progress.failed++;
      this.progress.errors.push({
        file: filePath,
        error: errorMsg
      });
      this.emit('progress', { ...this.progress });
      
      // Log the error
      const shouldLogError = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.error);
      if (shouldLogError) {
        console.error(`[ImageKit] Error processing ${filePath}:`, errorMsg);
      }
      
      // Re-throw to allow caller to handle the error
      throw error;
    }
  }

  /**
   * Upload an image to ImageKit with retry logic
   * @param filePath Path to the file being processed (for logging)
   * @param localImagePath Local path to the image file to upload
   * @param attempt Current retry attempt number (starts at 1)
   * @returns The ImageKit URL if successful, null otherwise
   */
  private async uploadImageToImageKitWithRetry(
    filePath: string,
    localImagePath: string,
    attempt = 1
  ): Promise<string | null> {
    const maxAttempts = this.config.retryAttempts || 3;
    const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
    const shouldLogError = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.error);

    try {
      if (shouldLog) {
        console.log(`[ImageKit] [${filePath}] Uploading screenshot (attempt ${attempt}/${maxAttempts})`);
      }

      // Add date to the filename
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
      const filename = path.basename(localImagePath);
      const filenameWithDate = `${dateStr}_${filename}`;
      
      // Read the file data
      const fileData = await fs.readFile(localImagePath);
      
      // Upload the file to ImageKit
      const imageKitUrl = await this.uploadScreenshotToImageKit(fileData, filenameWithDate);
      
      if (imageKitUrl) {
        if (shouldLog) {
          console.log(`[ImageKit] [${filePath}] Successfully uploaded screenshot to ImageKit`);
        }
        return imageKitUrl;
      }
      
      throw new Error('Upload to ImageKit returned no URL');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log the error if this is the last attempt or if we should always log errors
      if (attempt >= maxAttempts || shouldLogError) {
        console.error(
          `[ImageKit] [${filePath}] Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}`,
          shouldLogError ? error : ''
        );
      }

      // If we have retries left, wait and try again
      if (attempt < maxAttempts) {
        const baseDelay = this.config.retryDelayMs || 1000;
        const delayMs = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        
        if (shouldLog) {
          console.log(`[ImageKit] [${filePath}] Retrying in ${delayMs}ms...`);
        }
        
        await new Promise(r => setTimeout(r, delayMs));
        return this.uploadImageToImageKitWithRetry(filePath, imageUrl, attempt + 1);
      }
      
      // If we're out of retries, return null to indicate failure
      return null;
    }
  }

  /**
   * Downloads a file from a URL to a local path
   * @param url The URL to download from
   * @param filePath The local path to save the file to
   * @returns The path to the downloaded file
   * @throws Error if the download fails
   */
  /**
   * Generates a new screenshot URL using the OpenGraph.io API
   * @param targetUrl The URL to generate a screenshot for
   * @returns The screenshot URL or null if generation fails
   */
  private lastRequestTime: number = 0;
  private requestQueue: Array<() => void> = [];
  private processingQueue: boolean = false;

  /**
   * Process the next request in the queue with rate limiting
   */
  private async processQueue() {
    if (this.processingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    const nextRequest = this.requestQueue.shift()!;
    
    try {
      // Ensure at least 10 seconds between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const minDelay = 10000; // 10 seconds (10,000ms)
      
      if (timeSinceLastRequest < minDelay) {
        const delayNeeded = minDelay - timeSinceLastRequest;
        console.log(`[ImageKit] Rate limiting: Waiting ${delayNeeded}ms before next API call`);
        await new Promise(resolve => setTimeout(resolve, delayNeeded));
      }
      
      await nextRequest();
      this.lastRequestTime = Date.now();
    } finally {
      this.processingQueue = false;
      // Process next request in queue
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Add a request to the queue and process it
   */
  private async queueRequest<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedRequest = async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      
      this.requestQueue.push(wrappedRequest);
      this.processQueue();
    });
  }

  private async generateScreenshotUrl(targetUrl: string, attempt = 1): Promise<string | null> {
    const maxAttempts = 3;
    const baseDelay = 6000; // 6 seconds
    const apiKey = process.env.OPEN_GRAPH_IO_API_KEY;
    
    if (!apiKey) {
      console.error('[ImageKit] OPEN_GRAPH_IO_API_KEY environment variable is not set');
      return null;
    }

    const screenshotApiUrl = `https://opengraph.io/api/1.1/screenshot/${encodeURIComponent(targetUrl)}?dimensions=lg&quality=80&accept_lang=en&use_proxy=true&app_id=${apiKey}`;
    
    try {
      console.log(`[ImageKit] [Attempt ${attempt}/${maxAttempts}] Fetching screenshot from OpenGraph API for ${targetUrl}`);
      
      // Use the queue to manage rate limiting
      const response = await this.queueRequest(() => fetch(screenshotApiUrl));
      
      if (response.status === 429 || response.status >= 500) {
        // Handle rate limiting or server errors with exponential backoff
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`[ImageKit] API returned ${response.status}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.generateScreenshotUrl(targetUrl, attempt + 1);
        }
        throw new Error(`API returned ${response.status} after ${maxAttempts} attempts`);
      }
      
      if (!response.ok) {
        console.error(`[ImageKit] OpenGraph API returned ${response.status}: ${response.statusText}`);
        return null;
      }
      
      const data = await response.json();
      
      if (data?.screenshotUrl) {
        const screenshotUrl = data.screenshotUrl.trim();
        console.log(`[ImageKit] Successfully generated screenshot URL: ${screenshotUrl}`);
        return screenshotUrl;
      } else {
        console.error('[ImageKit] No screenshot URL in OpenGraph API response');
        return null;
      }
    } catch (error) {
      console.error(`[ImageKit] Error generating screenshot URL (attempt ${attempt}/${maxAttempts}):`, error);
      
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`[ImageKit] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateScreenshotUrl(targetUrl, attempt + 1);
      }
      
      return null;
    }
  }

  private async downloadFile(url: string, filePath: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://example.com/'
        }
      });
      
      if (!response.ok) {
        console.error(`[ImageKit] Download failed with status ${response.status}: ${response.statusText} for URL: ${url}`);
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }
      
      const buffer = await response.buffer();
      if (!buffer || buffer.length === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);
      console.log(`[ImageKit] Successfully downloaded file to: ${filePath}`);
      
      return filePath;
    } catch (error) {
      console.error(`[ImageKit] Error downloading file from ${url} to ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Uploads a file to ImageKit and returns the permanent URL
   * @param fileData The file data to upload
   * @param filename The filename to use for the uploaded file
   * @returns The ImageKit URL if successful, null otherwise
   * @throws Error if the upload fails
   */
  private async uploadScreenshotToImageKit(fileData: Buffer, filename: string): Promise<string | null> {
    // Validate required environment variables
    if (!process.env.IMAGEKIT_PUBLIC_KEY) {
      throw new Error('IMAGEKIT_PUBLIC_KEY environment variable is not set');
    }
    if (!process.env.IMAGEKIT_PRIVATE_KEY) {
      throw new Error('IMAGEKIT_PRIVATE_KEY environment variable is not set');
    }
    if (!process.env.IMAGEKIT_URL_ENDPOINT) {
      throw new Error('IMAGEKIT_URL_ENDPOINT environment variable is not set');
    }

    try {
      // Initialize ImageKit client
      const imagekit = new ImageKit({
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
      });

      // Ensure the screenshots directory has a trailing slash for consistency
      const screenshotsDir = 'screenshots';
      const filePath = `${screenshotsDir}/${filename}`.replace(/\/+/g, '/'); // Normalize path
      
      // Upload the file to ImageKit
      const uploadResponse = await imagekit.upload({
        file: fileData,
        fileName: filePath, // Include the full path with screenshots directory
        useUniqueFileName: true,
        overwriteFile: false,
        tags: ['auto-uploaded', 'screenshot', 'og-screenshot']
      });

      if (!uploadResponse?.url) {
        throw new Error('No URL returned from ImageKit upload');
      }

      return uploadResponse.url;
    } catch (error) {
      // Handle fetch aborted (timeout)
      if (error.name === 'AbortError') {
        throw new Error('Image download timed out (30s)');
      }
      
      // Re-throw with more context
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upload to ImageKit: ${errorMessage}`);
    }
  }

  /**
   * Updates the frontmatter with the ImageKit URL
   * @param frontmatter The frontmatter content as a string
   * @param imageKitUrl The ImageKit URL to add or update
   * @returns The updated frontmatter with the ImageKit URL
   * @throws Error if frontmatter is not a valid string or imageKitUrl is missing
   */
  public updateFrontmatterWithImageKitUrl(frontmatter: string, imageKitUrl: string): string {
    // Validate inputs
    if (typeof frontmatter !== 'string') {
      throw new Error('Frontmatter must be a string');
    }
    
    if (!imageKitUrl) {
      throw new Error('ImageKit URL is required');
    }
    
    // Ensure the URL is properly formatted
    const formattedUrl = imageKitUrl.trim();
    if (!formattedUrl.startsWith('http')) {
      throw new Error(`Invalid ImageKit URL: ${formattedUrl}`);
    }
    
    // Create the new property line
    const newProperty = `ik_screenshot_url: "${formattedUrl}"`;
    
    // Check if the property already exists
    if (frontmatter.includes('ik_screenshot_url:')) {
      // Update existing property
      return frontmatter.replace(
        /ik_screenshot_url:\s*["'][^"']*["']/,
        newProperty
      );
    } else {
      // Add new property before the closing ---
      const trimmedFrontmatter = frontmatter.trimEnd();
      if (trimmedFrontmatter.endsWith('---')) {
        // Insert before the closing ---
        return trimmedFrontmatter.replace(
          /\s*---\s*$/,
          `\n${newProperty}\n---\n`
        );
      } else {
        // No closing --- found, append to the end
        return `${trimmedFrontmatter}\n${newProperty}\n`;
      }
    }
  }
  
  /**
   * Shuts down the ImageKitService, cleaning up any resources.
   * This should be called when the service is no longer needed.
   */
  async shutdown(): Promise<void> {
    try {
      // Clear any pending uploads
      this.uploadQueue = [];
      
      // Clear processed URLs to free up memory
      this.processedUrls.clear();
      
      // Reset progress
      this.progress = {
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: []
      };
      
      // Emit shutdown event
      this.emit('shutdown');
      
      // Log shutdown
      const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
      if (shouldLog) {
        console.log('[ImageKit] Service shutdown completed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ImageKit] Error during service shutdown:', errorMessage);
      throw error; // Re-throw to allow handling by the caller
    }
  }
}