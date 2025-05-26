import ImageKit from 'imagekit';
import fetch from 'node-fetch';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

// Types for the expectation pattern
export interface ImageKitExpectation {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  url: string;
  filePath: string;
  result?: {
    imageKitUrl: string;
  };
  error?: string;
}

export class ImageKitService {
  private imagekit: ImageKit;
  private expectations: Map<string, ImageKitExpectation> = new Map();
  private tempDir: string;

  constructor() {
    if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY || !process.env.IMAGEKIT_URL_ENDPOINT) {
      throw new Error('ImageKit configuration is missing required environment variables');
    }

    this.imagekit = new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    });

    this.tempDir = path.join(process.cwd(), '.temp', 'screenshots');
    fs.mkdir(this.tempDir, { recursive: true }).catch(console.error);
  }

  /**
   * Create an expectation for uploading a screenshot to ImageKit
   * @param imageUrl The URL of the image to upload
   * @param filePath The path of the file this screenshot is for
   * @returns An expectation object that will be fulfilled asynchronously
   */
  createScreenshotUploadExpectation(imageUrl: string, filePath: string): ImageKitExpectation {
    const expectation: ImageKitExpectation = {
      id: uuidv4(),
      status: 'pending',
      url: imageUrl,
      filePath,
    };

    this.expectations.set(expectation.id, expectation);
    
    // Start processing in the background
    this.processScreenshotUpload(expectation.id).catch(console.error);
    
    return expectation;
  }

  /**
   * Process a screenshot upload in the background
   */
  private async processScreenshotUpload(expectationId: string): Promise<void> {
    const expectation = this.expectations.get(expectationId);
    if (!expectation) return;

    try {
      expectation.status = 'processing';
      
      // 1. Download the image
      const response = await fetch(expectation.url);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      const tempFilePath = path.join(this.tempDir, `${expectationId}.jpg`);
      await fs.writeFile(tempFilePath, buffer);

      try {
        // 2. Upload to ImageKit
        const uploadResponse = await this.imagekit.upload({
          file: buffer,
          fileName: `screenshot-${Date.now()}.jpg`,
          folder: '/screenshots',
          useUniqueFileName: true,
          overwriteFile: false,
        });

        // 3. Update expectation with result
        expectation.status = 'completed';
        expectation.result = {
          imageKitUrl: uploadResponse.url,
        };

      } finally {
        // Clean up temp file
        try {
          await fs.unlink(tempFilePath);
        } catch (error) {
          console.error('Error cleaning up temp file:', error);
        }
      }

    } catch (error) {
      expectation.status = 'failed';
      expectation.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  /**
   * Get the current status of an expectation
   */
  getExpectation(expectationId: string): ImageKitExpectation | undefined {
    return this.expectations.get(expectationId);
  }

  /**
   * Wait for an expectation to be fulfilled
   */
  async waitForExpectation(expectationId: string, timeoutMs = 30000): Promise<ImageKitExpectation> {
    const startTime = Date.now();
    const checkInterval = 100; // ms
    
    return new Promise((resolve, reject) => {
      const check = () => {
        const expectation = this.expectations.get(expectationId);
        
        if (!expectation) {
          return reject(new Error('Expectation not found'));
        }

        if (expectation.status === 'completed' || expectation.status === 'failed') {
          return resolve(expectation);
        }

        if (Date.now() - startTime > timeoutMs) {
          return reject(new Error('Timeout waiting for expectation'));
        }

        setTimeout(check, checkInterval);
      };

      check();
    });
  }
}

// Singleton instance
let instance: ImageKitService | null = null;

export function getImageKitService(): ImageKitService {
  if (!instance) {
    instance = new ImageKitService();
  }
  return instance;
}