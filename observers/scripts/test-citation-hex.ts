#!/usr/bin/env ts-node

/**
 * Test script for citation hex formatter
 * 
 * This script processes a single Markdown file, converting numeric citations to
 * unique hexadecimal identifiers and ensuring proper footnote formatting.
 * 
 * Usage:
 *   ts-node test-citation-hex.ts <file-path>
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as yaml from 'js-yaml'; // Using js-yaml instead of gray-matter per project rules

// Get the root directory (two levels up from the script)
const ROOT_DIR = path.resolve(__dirname, '../../..');

// Configuration for footnotes and registry
const CONFIG = {
  footnotes: {
    header: '# Footnotes',
    sectionLine: '***',
  },
  registry: {
    // Registry location - changed as requested
    path: path.join(ROOT_DIR, 'site/src/content/citations'),
    filename: 'citation-registry.json'
  }
};

// Citation registry to track citations across files
interface CitationData {
  hexId: string;
  sourceText?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceAuthor?: string;
  dateCreated: string;
  dateUpdated: string;
  files: string[]; // Files where this citation appears
}

/**
 * Citation Registry class
 * Maintains a registry of all citations across files
 * 
 * Implements persistence to disk in the specified location
 */
class CitationRegistry {
  private citations: Map<string, CitationData> = new Map();
  private registryDir: string;
  private registryPath: string;
  
  /**
   * Constructor for CitationRegistry
   * Initializes the registry directory and file path
   */
  constructor() {
    this.registryDir = CONFIG.registry.path;
    this.registryPath = path.join(this.registryDir, CONFIG.registry.filename);
  }
  
  /**
   * Add a new citation to the registry
   * @param hexId - The hexadecimal identifier for the citation
   * @param data - Citation data
   */
  addCitation(hexId: string, data: Partial<CitationData>): void {
    const existingCitation = this.citations.get(hexId);
    
    if (existingCitation) {
      // Update existing citation
      this.citations.set(hexId, {
        ...existingCitation,
        ...data,
        dateUpdated: new Date().toISOString()
      });
    } else {
      // Create new citation
      this.citations.set(hexId, {
        hexId,
        dateCreated: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        files: data.files || [],
        ...data
      });
    }
  }
  
  /**
   * Get citation data by hex ID
   * @param hexId - The hexadecimal identifier
   * @returns Citation data or undefined if not found
   */
  getCitation(hexId: string): CitationData | undefined {
    return this.citations.get(hexId);
  }
  
  /**
   * Update the list of files where a citation appears
   * @param hexId - The hexadecimal identifier
   * @param filePath - Path to the file
   */
  updateCitationFiles(hexId: string, filePath: string): void {
    const citation = this.citations.get(hexId);
    
    if (citation) {
      if (!citation.files.includes(filePath)) {
        citation.files.push(filePath);
        citation.dateUpdated = new Date().toISOString();
        this.citations.set(hexId, citation);
      }
    }
  }
  
  /**
   * Get all citations
   * @returns Map of all citations
   */
  getAllCitations(): Map<string, CitationData> {
    return this.citations;
  }
  
  /**
   * Save the citation registry to disk
   * @returns Promise that resolves when the registry is saved
   */
  async saveToDisk(): Promise<void> {
    try {
      // Create directory if it doesn't exist
      await fs.promises.mkdir(this.registryDir, { recursive: true });
      
      // Convert Map to object for JSON serialization
      const citationsObject = Object.fromEntries(this.citations);
      
      // Write to file
      await fs.promises.writeFile(
        this.registryPath,
        JSON.stringify(citationsObject, null, 2),
        'utf8'
      );
      
      console.log(`Citation registry saved to: ${this.registryPath}`);
    } catch (error) {
      console.error('Error saving citation registry:', error);
      throw error;
    }
  }
  
  /**
   * Load the citation registry from disk
   * @returns Promise that resolves when the registry is loaded
   */
  async loadFromDisk(): Promise<void> {
    try {
      // Check if registry file exists
      try {
        await fs.promises.access(this.registryPath);
      } catch (error) {
        // File doesn't exist, create empty registry
        console.log('Citation registry file not found, creating new registry');
        this.citations = new Map();
        return;
      }
      
      // Read registry file
      const registryData = await fs.promises.readFile(this.registryPath, 'utf8');
      
      // Parse JSON and convert to Map
      const citationsObject = JSON.parse(registryData);
      this.citations = new Map(Object.entries(citationsObject));
      
      console.log(`Loaded ${this.citations.size} citations from registry`);
    } catch (error) {
      console.error('Error loading citation registry:', error);
      // Start with empty registry in case of error
      this.citations = new Map();
    }
  }
}

/**
 * Split Markdown content into frontmatter and body
 * @param content - The full Markdown file content
 * @returns Object with frontmatter and body
 */
function splitFrontmatterAndContent(content: string): { 
  frontmatter: Record<string, any>; 
  body: string;
  hasFrontmatter: boolean;
} {
  // Check if content has frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (frontmatterMatch) {
    try {
      const frontmatterStr = frontmatterMatch[1];
      const body = frontmatterMatch[2];
      const frontmatter = yaml.load(frontmatterStr) as Record<string, any>;
      
      return {
        frontmatter,
        body,
        hasFrontmatter: true
      };
    } catch (error) {
      console.error('Error parsing frontmatter:', error);
      return {
        frontmatter: {},
        body: content,
        hasFrontmatter: false
      };
    }
  }
  
  return {
    frontmatter: {},
    body: content,
    hasFrontmatter: false
  };
}

/**
 * Combine frontmatter and body back into a Markdown file
 * @param frontmatter - The frontmatter object
 * @param body - The Markdown body content
 * @returns Combined Markdown content
 */
function combineFrontmatterAndContent(
  frontmatter: Record<string, any>,
  body: string,
  hasFrontmatter: boolean
): string {
  if (!hasFrontmatter && Object.keys(frontmatter).length === 0) {
    return body;
  }
  
  const frontmatterStr = yaml.dump(frontmatter);
  return `---\n${frontmatterStr}---\n\n${body}`;
}

/**
 * Generate a random hex ID of specified length
 * @param length - Length of the hex ID
 * @returns Random hex string
 */
function generateHexId(length: number = 6): string {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

/**
 * Detects and converts numeric citations to hex format
 * @param content - The markdown file content
 * @returns Object containing updated content and conversion statistics
 */
function convertNumericCitationsToHex(content: string): {
  updatedContent: string;
  stats: {
    numericCitationsFound: number;
    conversionsPerformed: number;
    existingHexCitations: number;
  }
} {
  // Statistics to track
  const stats = {
    numericCitationsFound: 0,
    conversionsPerformed: 0,
    existingHexCitations: 0
  };
  
  // Track citation mappings (numeric to hex)
  const citationMappings: Record<string, string> = {};
  
  // Find all numeric citations [^1], [^2], etc.
  const numericCitationRegex = /\[\^(\d+)\]/g;
  const numericCitations = [...content.matchAll(numericCitationRegex)];
  
  stats.numericCitationsFound = numericCitations.length;
  
  // Find all existing hex citations [^a1b2c3]
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...content.matchAll(hexCitationRegex)];
  
  stats.existingHexCitations = hexCitations.length;
  
  // Generate hex IDs for each numeric citation
  numericCitations.forEach(match => {
    const numericId = match[1];
    const fullMatch = match[0];
    
    // Check if we already have a mapping for this numeric ID
    if (!citationMappings[numericId]) {
      citationMappings[numericId] = generateHexId();
    }
    
    const hexId = citationMappings[numericId];
    stats.conversionsPerformed++;
  });
  
  // Replace all numeric citations with hex citations
  let updatedContent = content;
  
  // First replace all citation references [^1] -> [^a1b2c3]
  Object.entries(citationMappings).forEach(([numericId, hexId]) => {
    const numericRefRegex = new RegExp(`\\[\\^${numericId}\\]`, 'g');
    updatedContent = updatedContent.replace(numericRefRegex, `[^${hexId}]`);
  });
  
  // Then replace all citation definitions [^1]: -> [^a1b2c3]:
  Object.entries(citationMappings).forEach(([numericId, hexId]) => {
    const numericDefRegex = new RegExp(`\\[\\^${numericId}\\]:`, 'g');
    updatedContent = updatedContent.replace(numericDefRegex, `[^${hexId}]:`);
  });
  
  return {
    updatedContent,
    stats
  };
}

/**
 * Ensures all citations have corresponding footnote definitions
 * and creates a Footnotes section if needed
 * @param content - The markdown file content
 * @param citationRegistry - Registry of known citations
 * @returns Updated content with complete footnotes and statistics
 */
function ensureFootnotesComplete(
  content: string, 
  citationRegistry: CitationRegistry
): { 
  updatedContent: string;
  stats: {
    missingFootnotesAdded: number;
    footnoteSectionAdded: boolean;
  }
} {
  const stats = {
    missingFootnotesAdded: 0,
    footnoteSectionAdded: false
  };
  
  let updatedContent = content;
  
  // Find all citation references [^a1b2c3]
  const citationRefRegex = /\[\^([0-9a-f]{6})\]/g;
  const citationRefs = [...content.matchAll(citationRefRegex)];
  
  // Find all citation definitions [^a1b2c3]:
  const citationDefRegex = /\[\^([0-9a-f]{6})\]:/g;
  const citationDefs = [...content.matchAll(citationDefRegex)];
  
  // Create a set of defined citations
  const definedCitations = new Set(citationDefs.map(match => match[1]));
  
  // Check for missing definitions
  const missingDefinitions: string[] = [];
  
  citationRefs.forEach(match => {
    const hexId = match[1];
    
    if (!definedCitations.has(hexId)) {
      missingDefinitions.push(hexId);
    }
    
    // Update citation registry with this file
    citationRegistry.updateCitationFiles(hexId, process.argv[2] || 'unknown-file');
  });
  
  // Check if we need to add a Footnotes section
  const hasFootnotesSection = content.includes(CONFIG.footnotes.header);
  
  if (missingDefinitions.length > 0 || !hasFootnotesSection) {
    // We need to add missing definitions or create a Footnotes section
    
    if (!hasFootnotesSection) {
      // Add Footnotes section
      updatedContent += `\n\n${CONFIG.footnotes.header}\n${CONFIG.footnotes.sectionLine}\n`;
      stats.footnoteSectionAdded = true;
    }
    
    // Add missing definitions
    missingDefinitions.forEach(hexId => {
      // Get citation data from registry if available
      const citationData = citationRegistry.getCitation(hexId);
      
      let definitionText = '';
      if (citationData && citationData.sourceText) {
        definitionText = citationData.sourceText;
      } else {
        definitionText = 'Citation text missing. Please add citation details here.';
      }
      
      // Add definition to the end of the file
      updatedContent += `\n[^${hexId}]: ${definitionText}`;
      stats.missingFootnotesAdded++;
    });
  }
  
  return {
    updatedContent,
    stats
  };
}

/**
 * Extract citation text from footnote definition
 * @param content - The markdown file content
 * @param hexId - The hexadecimal identifier
 * @returns Citation text or undefined if not found
 */
function extractCitationText(content: string, hexId: string): string | undefined {
  const citationDefRegex = new RegExp(`\\[\\^${hexId}\\]:\\s*(.+)`, 'i');
  const match = content.match(citationDefRegex);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  return undefined;
}

/**
 * Process a single Markdown file
 * @param filePath - Path to the Markdown file
 * @returns Processing statistics
 */
async function processFile(filePath: string): Promise<{
  citationsConverted: number;
  footnotesAdded: number;
  footnoteSectionAdded: boolean;
}> {
  // Create citation registry
  const citationRegistry = new CitationRegistry();
  
  // Load existing registry
  await citationRegistry.loadFromDisk();
  
  // Read file content
  console.log(`Reading file: ${filePath}`);
  const content = await fs.promises.readFile(filePath, 'utf8');
  console.log(`Original content length: ${content.length} bytes`);
  console.log(`Original content contains numeric citations: ${content.includes('[^1]')}`);
  
  // Split into frontmatter and body
  const { frontmatter, body, hasFrontmatter } = splitFrontmatterAndContent(content);
  
  // Convert numeric citations to hex
  console.log(`Converting numeric citations to hex...`);
  const { updatedContent: bodyWithHexCitations, stats: conversionStats } = 
    convertNumericCitationsToHex(body);
  
  console.log(`After conversion, content contains numeric citations: ${bodyWithHexCitations.includes('[^1]')}`);
  console.log(`After conversion, content contains hex citations: ${/\[\^[0-9a-f]{6}\]/.test(bodyWithHexCitations)}`);
  
  // Ensure footnotes are complete
  const { updatedContent: finalBody, stats: footnoteStats } = 
    ensureFootnotesComplete(bodyWithHexCitations, citationRegistry);
  
  // Extract citation text for all hex citations and update registry
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...finalBody.matchAll(hexCitationRegex)];
  
  hexCitations.forEach(match => {
    const hexId = match[1];
    const citationText = extractCitationText(finalBody, hexId);
    
    if (citationText) {
      citationRegistry.addCitation(hexId, {
        sourceText: citationText,
        files: [filePath]
      });
    }
  });
  
  // Update frontmatter with citation information
  const updatedFrontmatter = {
    ...frontmatter,
    date_modified: new Date().toISOString().split('T')[0]
  };
  
  // Combine frontmatter and body
  const finalContent = combineFrontmatterAndContent(
    updatedFrontmatter, 
    finalBody,
    hasFrontmatter
  );
  
  console.log(`Final content length: ${finalContent.length} bytes`);
  console.log(`Final content contains numeric citations: ${finalContent.includes('[^1]')}`);
  console.log(`Final content contains hex citations: ${/\[\^[0-9a-f]{6}\]/.test(finalContent)}`);
  
  // Write changes if needed
  if (finalContent !== content) {
    console.log(`Content has changed, writing to file...`);
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    console.log(`Absolute file path: ${absoluteFilePath}`);
    
    try {
      await fs.promises.writeFile(filePath, finalContent, 'utf8');
      console.log(`File written successfully`);
      
      // Verify the file was updated
      const verifyContent = await fs.promises.readFile(filePath, 'utf8');
      console.log(`Verification: file contains numeric citations: ${verifyContent.includes('[^1]')}`);
      console.log(`Verification: file contains hex citations: ${/\[\^[0-9a-f]{6}\]/.test(verifyContent)}`);
      
      console.log(`Updated file: ${filePath}`);
    } catch (error) {
      console.error(`Error writing file: ${error}`);
      throw error;
    }
  } else {
    console.log(`No changes needed for: ${filePath}`);
  }
  
  // Save citation registry
  await citationRegistry.saveToDisk();
  
  // Log citation registry
  console.log('\nCitation Registry:');
  citationRegistry.getAllCitations().forEach((data, hexId) => {
    console.log(`  - [^${hexId}] appears in ${data.files.length} files`);
    if (data.sourceText) {
      // Truncate long source texts for display
      const displayText = data.sourceText.length > 50 
        ? `${data.sourceText.substring(0, 50)}...` 
        : data.sourceText;
      console.log(`    Text: ${displayText}`);
    }
  });
  
  return {
    citationsConverted: conversionStats.conversionsPerformed,
    footnotesAdded: footnoteStats.missingFootnotesAdded,
    footnoteSectionAdded: footnoteStats.footnoteSectionAdded
  };
}

/**
 * Main function
 */
async function main() {
  // Get file path from command line arguments
  const filePath = process.argv[2];
  
  if (!filePath) {
    console.error('Please provide a file path as an argument');
    process.exit(1);
  }
  
  // Check if file exists
  try {
    await fs.promises.access(filePath);
  } catch (error) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  console.log(`Processing file: ${filePath}`);
  console.log(`Root directory: ${ROOT_DIR}`);
  console.log(`Citation registry will be saved to: ${path.join(CONFIG.registry.path, CONFIG.registry.filename)}`);
  
  try {
    const stats = await processFile(filePath);
    
    console.log('\nProcessing complete!');
    console.log('Statistics:');
    console.log(`  - Citations converted: ${stats.citationsConverted}`);
    console.log(`  - Footnotes added: ${stats.footnotesAdded}`);
    console.log(`  - Footnote section added: ${stats.footnoteSectionAdded ? 'Yes' : 'No'}`);
  } catch (error) {
    console.error('Error processing file:', error);
    process.exit(1);
  }
}

// Run the script
main();
