/**
 * Enhance Concepts Frontmatter Script
 * 
 * This script processes Markdown files in the concepts directory,
 * analyzes their content, and enhances their frontmatter with
 * appropriate metadata. It uses an AI assistant to generate
 * suggestions and presents them to the user for approval.
 * 
 * Usage:
 *   pnpm ts-node enhance-concepts-frontmatter.ts [--dry-run] [--batch-size=10]
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
  // Source directory for concepts
  conceptsDir: path.resolve(process.cwd(), '../../../content/concepts'),
  
  // Default batch size
  batchSize: 10,
  
  // Dry run mode (don't actually modify files)
  dryRun: false,
  
  // Template for new frontmatter
  frontmatterTemplate: {
    site_uuid: '',
    date_created: new Date().toISOString(),
    date_modified: new Date().toISOString(),
    related_concepts: [],
    aliases: [],
    wikipedia_url: '',
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
  site_uuid?: string;
  date_created?: string;
  date_modified?: string;
  related_concepts?: string[];
  aliases?: string[];
  wikipedia_url?: string;
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
  
  // Ensure related_concepts is an array
  if (!Array.isArray(formattedFrontmatter.related_concepts)) {
    formattedFrontmatter.related_concepts = formattedFrontmatter.related_concepts 
      ? [formattedFrontmatter.related_concepts as unknown as string] 
      : [];
  }
  
  // Ensure aliases is an array
  if (!Array.isArray(formattedFrontmatter.aliases)) {
    formattedFrontmatter.aliases = formattedFrontmatter.aliases 
      ? [formattedFrontmatter.aliases as unknown as string] 
      : [];
  }
  
  // Generate YAML
  let yamlString = yaml.dump(formattedFrontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"'
  });
  
  return yamlString;
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
    rl.question(`${question} (y/n) `, (answer) => {
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
      resolve(answer || defaultValue);
    });
  });
}

/**
 * Get related concepts from file path and content
 * 
 * @param filePath - Path to the file
 * @param content - Content of the file
 * @returns Array of related concepts
 */
function getRelatedConcepts(filePath: string, content: string): string[] {
  // Extract concept name from filename
  const conceptName = path.basename(filePath, '.md');
  
  // This is a simple example - in a real implementation, you might use NLP
  // or other techniques to extract related concepts from the content
  const relatedConcepts: string[] = [];
  
  // For now, just return an empty array
  return relatedConcepts;
}

/**
 * Present frontmatter to user for approval
 * 
 * @param filePath - Path to the file
 * @param frontmatter - Frontmatter to present
 * @returns Promise that resolves to approved frontmatter or null
 */
async function presentToUser(filePath: string, frontmatter: Frontmatter): Promise<Frontmatter | null> {
  console.log(`\nFile: ${filePath}`);
  console.log('Proposed frontmatter:');
  console.log(yaml.dump(frontmatter, { lineWidth: -1 }));
  
  const options = [
    'Accept as is',
    'Edit manually',
    'Skip file'
  ];
  
  for (let i = 0; i < options.length; i++) {
    console.log(`${i + 1}. ${options[i]}`);
  }
  
  const rl = createReadlineInterface();
  
  const choice = await new Promise<number>((resolve) => {
    rl.question('Choose an option (1-3): ', (answer) => {
      rl.close();
      const num = parseInt(answer, 10);
      if (isNaN(num) || num < 1 || num > options.length) {
        resolve(1); // Default to accept
      } else {
        resolve(num);
      }
    });
  });
  
  if (choice === 1) {
    return frontmatter;
  } else if (choice === 2) {
    // Edit manually
    const tempFile = path.join(process.cwd(), 'temp-frontmatter.yml');
    fs.writeFileSync(tempFile, yaml.dump(frontmatter, { lineWidth: -1 }));
    
    try {
      execSync(`${process.env.EDITOR || 'vim'} ${tempFile}`, { stdio: 'inherit' });
      
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
  
  return null; // Skip file
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
    
    // Skip files that already have good frontmatter with required fields
    if (frontmatter && 
        frontmatter.site_uuid && 
        frontmatter.date_created && 
        frontmatter.date_modified) {
      console.log(`Skipping ${filePath} - already has required frontmatter`);
      return false;
    }
    
    // Start with template or existing frontmatter
    const baseFrontmatter = {
      ...CONFIG.frontmatterTemplate,
      ...(frontmatter || {})
    };
    
    // Update date_modified to current time
    baseFrontmatter.date_modified = new Date().toISOString();
    
    // If site_uuid is missing, generate a new one
    if (!baseFrontmatter.site_uuid) {
      // In a real implementation, you would use a UUID generator
      baseFrontmatter.site_uuid = `concept-${Date.now().toString(36)}`;
    }
    
    // Get related concepts
    if (!baseFrontmatter.related_concepts || baseFrontmatter.related_concepts.length === 0) {
      baseFrontmatter.related_concepts = getRelatedConcepts(filePath, bodyContent);
    }
    
    // Present to user for approval
    const approvedFrontmatter = await presentToUser(filePath, baseFrontmatter);
    
    if (approvedFrontmatter) {
      // Update the file with new frontmatter
      const frontmatterYaml = generateFrontmatterYaml(approvedFrontmatter);
      const updatedContent = `---\n${frontmatterYaml}---\n\n${bodyContent}`;
      
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
    const files = glob.sync(`${CONFIG.conceptsDir}/**/*.md`);
    
    console.log(`Found ${files.length} markdown files in ${CONFIG.conceptsDir}`);
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
