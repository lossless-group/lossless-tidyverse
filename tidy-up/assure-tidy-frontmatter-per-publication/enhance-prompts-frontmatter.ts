/**
 * Enhance Prompts Frontmatter Script
 * 
 * This script processes Markdown files in the prompts directory,
 * analyzes their content, and enhances their frontmatter with
 * appropriate titles and ledes. It uses an AI assistant to generate
 * suggestions and presents them to the user for approval.
 * 
 * Usage:
 *   pnpm ts-node enhance-prompts-frontmatter.ts [--dry-run] [--batch-size=10]
 * 
 * Options:
 *   --dry-run     Don't actually modify files, just show what would be done
 *   --batch-size  Number of files to process in one batch (default: 10)
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import yaml from 'js-yaml';
import readline from 'readline';
import { execSync } from 'child_process';

// Configuration
const CONFIG = {
  // Source directory for prompts
  promptsDir: path.resolve(process.cwd(), '../../../content/lost-in-public/prompts'),
  
  // Default batch size
  batchSize: 10,
  
  // Dry run mode (don't actually modify files)
  dryRun: false,
  
  // Template for new frontmatter
  frontmatterTemplate: {
    title: '',
    lede: '',
    date_authored_initial_draft: new Date().toISOString().split('T')[0],
    date_authored_current_draft: new Date().toISOString().split('T')[0],
    date_authored_final_draft: null,
    date_first_published: null,
    date_last_updated: null,
    at_semantic_version: '0.0.0.1',
    authors: "\n - Michael Staton",
    status: 'To-Prompt',
    augmented_with: 'Windsurf Cascade on Claude 3.5 Sonnet',
    category: 'Prompts',
    tags: [],
  }
};

// Process command line arguments
process.argv.slice(2).forEach(arg => {
  if (arg === '--dry-run') {
    CONFIG.dryRun = true;
  } else if (arg.startsWith('--batch-size=')) {
    CONFIG.batchSize = parseInt(arg.split('=')[1], 10);
  }
});

/**
 * Interface for frontmatter data
 */
interface Frontmatter {
  title?: string;
  lede?: string;
  date_authored_initial_draft?: string;
  date_authored_current_draft?: string;
  date_authored_final_draft?: string | null;
  date_first_published?: string | null;
  date_last_updated?: string | null;
  at_semantic_version?: string;
  authors?: string | string[];
  status?: string;
  augmented_with?: string;
  category?: string;
  tags?: string[];
  date_created?: string;
  date_modified?: string;
  [key: string]: any;
}

/**
 * Result of extracting frontmatter from a file
 */
interface FrontmatterResult {
  frontmatter: Frontmatter | null;
  content: string;
  hasFrontmatter: boolean;
}

/**
 * Extract frontmatter from file content
 * 
 * @param fileContent - The content of the file
 * @returns Object containing frontmatter and content
 */
function extractFrontmatter(fileContent: string): FrontmatterResult {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = fileContent.match(frontmatterRegex);
  
  if (match) {
    try {
      const frontmatterYaml = match[1];
      const content = match[2];
      const frontmatter = yaml.load(frontmatterYaml) as Frontmatter;
      
      return {
        frontmatter,
        content,
        hasFrontmatter: true
      };
    } catch (error) {
      console.error('Error parsing frontmatter:', error);
      return {
        frontmatter: null,
        content: fileContent,
        hasFrontmatter: false
      };
    }
  }
  
  return {
    frontmatter: null,
    content: fileContent,
    hasFrontmatter: false
  };
}

/**
 * Generate frontmatter YAML string
 * 
 * @param frontmatter - The frontmatter object
 * @returns YAML string representation of frontmatter
 */
function generateFrontmatterYaml(frontmatter: Frontmatter): string {
  // Ensure arrays are properly formatted
  const formattedFrontmatter = { ...frontmatter };
  
  // Special handling for authors to preserve the exact format
  const authorsValue = formattedFrontmatter.authors;
  delete formattedFrontmatter.authors;
  
  // Ensure tags is an array
  if (!Array.isArray(formattedFrontmatter.tags)) {
    formattedFrontmatter.tags = formattedFrontmatter.tags 
      ? [formattedFrontmatter.tags as unknown as string] 
      : [];
  }
  
  // Generate YAML
  let yamlString = yaml.dump(formattedFrontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"'
  });
  
  // Add authors back in the exact format from the template
  if (authorsValue) {
    yamlString = yamlString.replace(
      /(at_semantic_version:.*\n)/,
      `$1authors: ${authorsValue}\n`
    );
  }
  
  return `---\n${yamlString}---\n`;
}

/**
 * Create a readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Ask user for confirmation
 * 
 * @param question - The question to ask
 * @returns Promise that resolves to boolean answer
 */
async function askForConfirmation(question: string): Promise<boolean> {
  const rl = createReadlineInterface();
  
  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Ask user for input with a default value
 * 
 * @param question - The question to ask
 * @param defaultValue - The default value
 * @returns Promise that resolves to user input
 */
async function askForInput(question: string, defaultValue: string): Promise<string> {
  const rl = createReadlineInterface();
  
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * Get tags from file path
 * 
 * @param filePath - Path to the file
 * @returns Array of tags
 */
function getTagsFromPath(filePath: string): string[] {
  // Extract all directory names after 'prompts'
  const pathParts = filePath.split('/');
  const promptsIndex = pathParts.findIndex(part => part === 'prompts');
  
  if (promptsIndex >= 0) {
    // Get all directory names after 'prompts' and before the filename
    const tags = pathParts.slice(promptsIndex + 1, -1).map(tag => {
      // Convert to Train-Case format
      return tag.replace(/\s+/g, '-');
    });
    
    return tags.length > 0 ? tags : ['Uncategorized'];
  }
  
  return ['Uncategorized'];
}

/**
 * Generate a title from filename
 * 
 * @param filePath - Path to the file
 * @returns Generated title
 */
function getTitleFromFilename(filePath: string): string {
  const filename = path.basename(filePath, '.md');
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Use AI assistant to generate frontmatter suggestions
 * 
 * @param filePath - Path to the file
 * @param existingFrontmatter - Existing frontmatter if any
 * @param content - Content of the file
 * @returns Promise that resolves to enhanced frontmatter
 */
async function getAIEnhancedFrontmatter(
  filePath: string,
  existingFrontmatter: Frontmatter | null,
  content: string
): Promise<Frontmatter> {
  // Start with template or existing frontmatter
  const baseFrontmatter: Frontmatter = {
    ...CONFIG.frontmatterTemplate,
    ...(existingFrontmatter || {})
  };
  
  // Generate title from filename if not present
  if (!baseFrontmatter.title) {
    baseFrontmatter.title = getTitleFromFilename(filePath);
  }
  
  // Generate tags from path if not present
  if (!baseFrontmatter.tags || baseFrontmatter.tags.length === 0) {
    baseFrontmatter.tags = getTagsFromPath(filePath);
  }
  
  // Get current date for date fields if not present
  const today = new Date().toISOString().split('T')[0];
  if (!baseFrontmatter.date_authored_initial_draft) {
    baseFrontmatter.date_authored_initial_draft = today;
  }
  if (!baseFrontmatter.date_authored_current_draft) {
    baseFrontmatter.date_authored_current_draft = today;
  }
  
  // For now, we'll use these basic generations
  // In a real implementation, this would call an AI API or use a local model
  
  console.log(`\n\nAnalyzing file: ${filePath}`);
  console.log('Content preview:');
  console.log(content.substring(0, 500) + '...');
  
  // Ask user for title and lede
  const title = await askForInput('Enter title', baseFrontmatter.title || '');
  
  let ledePrompt = 'Enter lede (brief description)';
  if (baseFrontmatter.lede) {
    ledePrompt = `Current lede: "${baseFrontmatter.lede}"\nEnter new lede`;
  }
  const lede = await askForInput(ledePrompt, baseFrontmatter.lede || '');
  
  return {
    ...baseFrontmatter,
    title,
    lede
  };
}

/**
 * Present frontmatter to user for approval
 * 
 * @param filePath - Path to the file
 * @param frontmatter - Frontmatter to present
 * @returns Promise that resolves to approved frontmatter or null
 */
async function presentToUser(filePath: string, frontmatter: Frontmatter): Promise<Frontmatter | null> {
  console.log(`\n\nProposed frontmatter for: ${filePath}`);
  console.log(yaml.dump(frontmatter, { lineWidth: -1 }));
  
  const approved = await askForConfirmation('Approve this frontmatter?');
  
  if (approved) {
    return frontmatter;
  }
  
  const editManually = await askForConfirmation('Would you like to edit it manually?');
  
  if (editManually) {
    // Create a temporary file with the frontmatter
    const tempFile = path.join(process.cwd(), 'temp-frontmatter.yml');
    fs.writeFileSync(tempFile, yaml.dump(frontmatter, { lineWidth: -1 }));
    
    // Open the file in the default editor
    try {
      execSync(`${process.env.EDITOR || 'vim'} ${tempFile}`, { stdio: 'inherit' });
      
      // Read the edited frontmatter
      const editedYaml = fs.readFileSync(tempFile, 'utf8');
      fs.unlinkSync(tempFile); // Clean up
      
      try {
        return yaml.load(editedYaml) as Frontmatter;
      } catch (error) {
        console.error('Error parsing edited frontmatter:', error);
        return null;
      }
    } catch (error) {
      console.error('Error opening editor:', error);
      fs.unlinkSync(tempFile); // Clean up
      return null;
    }
  }
  
  return null;
}

/**
 * Process a single file
 * 
 * @param filePath - Path to the file
 * @returns Promise that resolves when file is processed
 */
async function processFile(filePath: string): Promise<boolean> {
  try {
    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract existing frontmatter if any
    const { frontmatter, content: bodyContent, hasFrontmatter } = extractFrontmatter(content);
    
    // Skip files that already have good frontmatter with title and lede
    if (frontmatter && 
        frontmatter.title && 
        frontmatter.lede && 
        !frontmatter.title.includes('TODO') && 
        !frontmatter.lede.includes('TODO')) {
      console.log(`Skipping ${filePath} - already has good frontmatter`);
      return false;
    }
    
    // Get enhanced frontmatter
    const enhancedFrontmatter = await getAIEnhancedFrontmatter(
      filePath, 
      frontmatter, 
      bodyContent
    );
    
    // Present to user for approval
    const approvedFrontmatter = await presentToUser(filePath, enhancedFrontmatter);
    
    if (approvedFrontmatter) {
      // Update the file with new frontmatter
      const frontmatterYaml = generateFrontmatterYaml(approvedFrontmatter);
      const updatedContent = frontmatterYaml + bodyContent;
      
      if (!CONFIG.dryRun) {
        fs.writeFileSync(filePath, updatedContent);
        console.log(`Updated ${filePath} with approved frontmatter`);
      } else {
        console.log(`[DRY RUN] Would update ${filePath} with approved frontmatter`);
      }
      
      return true;
    } else {
      console.log(`Skipping ${filePath} - frontmatter not approved`);
      return false;
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return false;
  }
}

/**
 * Main function to process all files
 */
async function main() {
  try {
    // Find all markdown files
    const files = glob.sync(`${CONFIG.promptsDir}/**/*.md`);
    
    console.log(`Found ${files.length} markdown files in ${CONFIG.promptsDir}`);
    console.log(`Processing in batches of ${CONFIG.batchSize}`);
    console.log(`Dry run: ${CONFIG.dryRun ? 'Yes' : 'No'}`);
    
    // Process files in batches
    for (let i = 0; i < files.length; i += CONFIG.batchSize) {
      const batch = files.slice(i, i + CONFIG.batchSize);
      
      console.log(`\nProcessing batch ${Math.floor(i / CONFIG.batchSize) + 1} of ${Math.ceil(files.length / CONFIG.batchSize)}`);
      
      // Ask for confirmation before processing batch
      const proceed = await askForConfirmation(`Process ${batch.length} files?`);
      
      if (!proceed) {
        console.log('Skipping batch');
        continue;
      }
      
      // Process each file in the batch
      let processed = 0;
      for (const file of batch) {
        const success = await processFile(file);
        if (success) processed++;
      }
      
      console.log(`Batch complete: ${processed} files updated`);
    }
    
    console.log('\nAll files processed');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

// Run the main function
main();
