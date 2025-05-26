import ImageKit from 'imagekit';
import fetch from 'node-fetch';
import fs from 'node:fs/promises';
import path from 'node:path';

// Track in-progress uploads to prevent duplicates
const screenshotUploadInProgress = new Set<string>();

/**
 * Uploads a screenshot to ImageKit and returns the permanent URL
 * @param imageUrl The URL of the image to upload
 * @returns The ImageKit URL or null if upload fails
 */
async function uploadScreenshotToImageKit(imageUrl: string): Promise<string | null> {
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
    console.error('Error uploading to ImageKit:', error);
    return null;
  }
}

/**
 * Uploads a screenshot to ImageKit in the background and updates the file when done
 * @param imageUrl The URL of the image to upload
 * @param filePath The path to the file to update
 */
export function uploadScreenshotInBackground(imageUrl: string, filePath: string): void {
  // Skip if we're already processing this URL
  if (screenshotUploadInProgress.has(imageUrl)) {
    console.log(`Screenshot upload already in progress for ${imageUrl}, skipping duplicate request`);
    return;
  }

  // Add to tracking set
  screenshotUploadInProgress.add(imageUrl);
  
  console.log(`Starting background screenshot upload for ${imageUrl} (${filePath})`);

  // Process in background
  (async () => {
    try {
      const imageKitUrl = await uploadScreenshotToImageKit(imageUrl);
      
      if (imageKitUrl) {
        console.log(`✅ Successfully uploaded screenshot to ImageKit: ${imageKitUrl}`);
        await updateFileWithImageKitUrl(filePath, imageKitUrl);
      } else {
        console.log(`⚠️ Failed to upload screenshot for ${imageUrl}`);
      }
    } catch (error) {
      console.error(`Error in background screenshot upload for ${imageUrl}:`, error);
    } finally {
      // Clean up
      screenshotUploadInProgress.delete(imageUrl);
    }
  })();
}

/**
 * Updates a file with the ImageKit URL in its frontmatter
 * @param filePath Path to the file to update
 * @param imageKitUrl The ImageKit URL to set
 */
async function updateFileWithImageKitUrl(filePath: string, imageKitUrl: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const frontmatterEnd = content.indexOf('---', 3);
    
    if (frontmatterEnd === -1) {
      throw new Error('No frontmatter found in file');
    }

    const frontmatter = content.slice(0, frontmatterEnd);
    const restOfContent = content.slice(frontmatterEnd);
    
    // Add or update the og_screenshot_url
    let updatedFrontmatter: string;
    if (frontmatter.includes('og_screenshot_url:')) {
      updatedFrontmatter = frontmatter.replace(
        /og_screenshot_url:.*$/m,
        `og_screenshot_url: ${imageKitUrl}`
      );
    } else {
      updatedFrontmatter = `${frontmatter.trimEnd()}\nog_screenshot_url: ${imageKitUrl}\n`;
    }

    // Write back to file
    await fs.writeFile(filePath, updatedFrontmatter + restOfContent, 'utf8');
    console.log(`✅ Updated ${filePath} with ImageKit URL`);
  } catch (error) {
    console.error(`Error updating file ${filePath}:`, error);
    throw error;
  }
}