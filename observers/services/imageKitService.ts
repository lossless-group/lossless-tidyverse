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
   * @param frontmatter The frontmatter object containing the URL to process
   * @returns The ImageKit URL if successful, null otherwise
   */
  async processScreenshots(filePath: string, frontmatter: any): Promise<string | null> {
    try {
      if (!this.config.enabled) {
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] Service is disabled, skipping ${filePath}`);
        }
        return null;
      }

      const imageUrl = frontmatter.open_graph_url || frontmatter.url;
      if (!imageUrl) {
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] No URL found in frontmatter for ${filePath}`);
        }
        return null;
      }

      // Skip if we already have an ImageKit URL and overwrite is disabled
      if (frontmatter.ik_screenshot_url && !this.config.overwriteScreenshotUrl) {
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] Screenshot exists and overwrite is disabled for ${filePath}`);
        }
        return frontmatter.ik_screenshot_url;
      }

      this.progress.total++;
      this.emit('progress', { ...this.progress });

      // Process the file
      const imageKitUrl = await this.uploadImageToImageKitWithRetry(filePath, imageUrl);
      
      if (imageKitUrl) {
        this.progress.succeeded++;
        this.progress.processed++;
        this.emit('progress', { ...this.progress });
        return imageKitUrl;
      } else {
        this.progress.failed++;
        this.progress.errors.push({
          file: filePath,
          error: 'Failed to upload screenshot after retries'
        });
        this.progress.processed++;
        this.emit('progress', { ...this.progress });
        return null;
      }
    } catch (error) {
      this.progress.failed++;
      this.progress.errors.push({
        file: filePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.emit('progress', { ...this.progress });
      throw error;
    }
  }

  /**
   * Upload an image to ImageKit with retry logic
   * @returns The ImageKit URL if successful, null otherwise
   */
  private async uploadImageToImageKitWithRetry(
    filePath: string,
    imageUrl: string,
    attempt = 1
  ): Promise<string | null> {
    try {
      const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
      if (shouldLog) {
        console.log(`[ImageKit] Uploading screenshot (attempt ${attempt}/${this.config.retryAttempts || 3}) for ${filePath}`);
      }

      const imageKitUrl = await this.uploadScreenshotToImageKit(imageUrl);
      
      if (imageKitUrl) {
        const shouldLog = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.info);
        if (shouldLog) {
          console.log(`[ImageKit] Successfully uploaded screenshot to ImageKit for ${filePath}`);
        }
        return imageKitUrl;
      }
      
      throw new Error('Failed to upload to ImageKit');
    } catch (error) {
      if (attempt < (this.config.retryAttempts || 3)) {
        const delayMs = this.config.retryDelayMs || 1000 * attempt;
        await new Promise(r => setTimeout(r, delayMs));
        return this.uploadImageToImageKitWithRetry(filePath, imageUrl, attempt + 1);
      }
      
      const shouldLogError = this.config.logging === true || (typeof this.config.logging === 'object' && this.config.logging.error);
      if (shouldLogError) {
        console.error(`[ImageKit] Failed to process ${filePath} after ${attempt} attempts:`, error);
      }
      return false;
    }
  }

  /**
   * Uploads a screenshot to ImageKit and returns the permanent URL
   */
  private async uploadScreenshotToImageKit(imageUrl: string): Promise<string | null> {
    try {
      // Download the image
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      
      // Initialize ImageKit
      const imagekit = new ImageKit({
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!,
      });

      // Upload to ImageKit
      const uploadResponse = await imagekit.upload({
        file: buffer,
        fileName: `screenshot-${Date.now()}.jpg`,
        folder: '/screenshots',
        useUniqueFileName: true,
        overwriteFile: false,
      });

      return uploadResponse.url;
    } catch (error) {
      console.error('[ImageKit] Error uploading to ImageKit:', error);
      throw error;
    }
  }

  /**
   * Updates the frontmatter with the ImageKit URL
   * @param frontmatter The frontmatter content as a string
   * @param imageKitUrl The ImageKit URL to add
   * @returns The updated frontmatter with the ImageKit URL
   */
  public updateFrontmatterWithImageKitUrl(frontmatter: string, imageKitUrl: string): string {
    if (frontmatter.includes('ik_screenshot_url:')) {
      return frontmatter.replace(
        /ik_screenshot_url:.*$/m,
        `ik_screenshot_url: "${imageKitUrl}"`
      );
    } else {
      return `${frontmatter.trimEnd()}\nik_screenshot_url: "${imageKitUrl}"\n`;
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