/**
 * Citation Service
 * 
 * Processes citations in markdown files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { formatFrontmatter } from '../../../site_archive/fileSystemObserver';

/**
 * Configuration for citation processing
 */
export interface CitationConfig {
  // Path to the citation registry file
  registryPath: string;
  // Length of hex IDs for citations
  hexLength: number;
  // Header for the footnotes section
  footnotesSectionHeader: string;
  // Separator line for the footnotes section
  footnotesSectionSeparator: string;
}

// Default configuration
const DEFAULT_CONFIG: CitationConfig = {
  registryPath: path.join(process.cwd(), '../../site/src/content/citations/citation-registry.json'),
  hexLength: 6,
  footnotesSectionHeader: '# Footnotes',
  footnotesSectionSeparator: '***'
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
 */
export class CitationRegistry {
  private citations: Map<string, CitationData> = new Map();
  private config: CitationConfig;
  private static instance: CitationRegistry;
  
  /**
   * Get the singleton instance of CitationRegistry
   * @returns The CitationRegistry instance
   */
  public static getInstance(config: CitationConfig = DEFAULT_CONFIG): CitationRegistry {
    if (!CitationRegistry.instance) {
      CitationRegistry.instance = new CitationRegistry(config);
    }
    return CitationRegistry.instance;
  }
  
  /**
   * Constructor for CitationRegistry
   * Initializes the registry file path
   */
  private constructor(config: CitationConfig) {
    this.config = config;
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
      // Convert Map to object for JSON serialization
      const citationsObject = Object.fromEntries(this.citations);
      
      // Write to file
      await fs.writeFile(
        this.config.registryPath,
        JSON.stringify(citationsObject, null, 2),
        'utf8'
      );
      
      console.log(`Citation registry saved to: ${this.config.registryPath}`);
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
        await fs.access(this.config.registryPath);
      } catch (error) {
        // File doesn't exist, create empty registry
        console.log('Citation registry file not found, creating new registry');
        this.citations = new Map();
        return;
      }
      
      // Read registry file
      const registryData = await fs.readFile(this.config.registryPath, 'utf8');
      
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
 * Extract frontmatter and body from a markdown file using regex
 * @param content The content of the markdown file
 * @returns The frontmatter and body
 */
function extractFrontmatterAndBody(content: string): { frontmatter: Record<string, any>; body: string } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  
  if (!frontmatterMatch) {
    return null;
  }
  
  try {
    const frontmatterStr = frontmatterMatch[1];
    const body = frontmatterMatch[2];
    
    // Parse frontmatter using regex, not YAML library
    const frontmatter: Record<string, any> = {};
    
    // Split by lines and process each line
    const lines = frontmatterStr.split('\n');
    
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
      frontmatter,
      body
    };
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return null;
  }
}

/**
 * Combine frontmatter and body into a markdown file
 * @param frontmatter The frontmatter
 * @param body The body
 * @returns The combined content
 */
function combineFrontmatterAndBody(frontmatter: Record<string, any>, body: string): string {
  if (!frontmatter) {
    return body;
  }
  
  // Use our custom formatFrontmatter function to generate YAML
  const frontmatterStr = formatFrontmatter(frontmatter);
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
 * Detects and converts numeric citations to hex format using efficient data structures
 * @param content - The markdown file content
 * @param registry - The citation registry instance
 * @returns Object containing updated content and conversion statistics
 */
function convertNumericCitationsToHex(
  content: string,
  registry: CitationRegistry
): {
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
  
  // PHASE 1: Discovery - Find all numeric citations
  const numericCitationRegex = /\[\^(\d+)\]/g;
  const numericMatches = [...content.matchAll(numericCitationRegex)];
  stats.numericCitationsFound = numericMatches.length;
  
  // Find all existing hex citations [^a1b2c3]
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexMatches = [...content.matchAll(hexCitationRegex)];
  stats.existingHexCitations = hexMatches.length;
  
  // If no numeric citations found, return original content
  if (numericMatches.length === 0) {
    return {
      updatedContent: content,
      stats
    };
  }
  
  // PHASE 2: Consolidation - Group by citation number
  // Map: citation number -> array of match positions
  const citationGroups = new Map<string, Array<{
    index: number, 
    length: number,
    fullMatch: string
  }>>();
  
  for (const match of numericMatches) {
    const numericId = match[1];
    const position = {
      index: match.index!,
      length: match[0].length,
      fullMatch: match[0]
    };
    
    if (!citationGroups.has(numericId)) {
      citationGroups.set(numericId, []);
    }
    
    citationGroups.get(numericId)!.push(position);
  }
  
  // PHASE 3: Extract citation texts and create mappings
  const numericCitationTexts: Record<string, string> = {};
  
  // For each unique numeric citation, try to extract its text
  for (const numericId of citationGroups.keys()) {
    const citationText = extractCitationText(content, numericId);
    if (citationText) {
      numericCitationTexts[numericId] = citationText;
    }
  }
  
  // Check if we already have citations with the same text in the registry
  const allCitations = registry.getAllCitations();
  const textToHexMap: Record<string, string> = {};
  
  // Build a map of citation text to hex ID from existing registry
  allCitations.forEach((citation, hexId) => {
    if (citation.sourceText) {
      textToHexMap[citation.sourceText] = hexId;
    }
  });
  
  // PHASE 4: Mapping - Create unique hex IDs for each citation number
  // Map: citation number -> hex ID
  const hexMappings: Record<string, string> = {};
  
  // Generate hex IDs for each unique numeric citation
  for (const numericId of citationGroups.keys()) {
    const citationText = numericCitationTexts[numericId];
    
    // If we have the citation text, check if we already have a hex ID for it
    if (citationText && textToHexMap[citationText]) {
      // Reuse existing hex ID for the same citation text
      hexMappings[numericId] = textToHexMap[citationText];
      console.log(`Reusing existing hex ID ${textToHexMap[citationText]} for citation: ${citationText.substring(0, 30)}...`);
    } else {
      // Generate a new hex ID
      hexMappings[numericId] = generateHexId();
      console.log(`Generated new hex ID ${hexMappings[numericId]} for citation ${numericId}`);
      
      // Add to our text-to-hex map for future reference
      if (citationText) {
        textToHexMap[citationText] = hexMappings[numericId];
      }
    }
    
    stats.conversionsPerformed++;
  }
  
  // PHASE 5: Replacement - Replace all instances
  // We need to replace from end to beginning to avoid position shifts
  let updatedContent = content;
  
  // First replace all citation references [^1] -> [^a1b2c3]
  Object.entries(hexMappings).forEach(([numericId, hexId]) => {
    const numericRefRegex = new RegExp(`\\[\\^${numericId}\\]`, 'g');
    updatedContent = updatedContent.replace(numericRefRegex, `[^${hexId}]`);
  });
  
  // Then replace all citation definitions [^1]: -> [^a1b2c3]:
  Object.entries(hexMappings).forEach(([numericId, hexId]) => {
    const numericDefRegex = new RegExp(`\\[\\^${numericId}\\]:`, 'g');
    updatedContent = updatedContent.replace(numericDefRegex, `[^${hexId}]:`);
  });
  
  // Update the registry with citation information
  Object.entries(hexMappings).forEach(([numericId, hexId]) => {
    const citationText = numericCitationTexts[numericId] || "Citation text needed";
    
    // Add or update the citation in the registry
    registry.addCitation(hexId, {
      sourceText: citationText
    });
  });
  
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
 * Fix spacing around citations
 * Ensures there's at least one space before citations and one space or newline after
 * @param content - The markdown content
 * @returns The content with fixed spacing
 */
function fixCitationSpacing(content: string): string {
  // Ensure space before citation
  content = content.replace(/([^\s])\[\^/g, '$1 [^');
  
  // Ensure space or newline after citation
  content = content.replace(/\]([^\s\n])/g, '] $1');
  
  return content;
}

/**
 * Convert citations without carets to the proper format
 * @param content - The markdown content
 * @returns The content with all citations having carets
 */
function convertCitationsToCaret(content: string): string {
  // Pattern for numeric citations without caret: [123]
  // Negative lookahead to avoid matching markdown links [text](url) or [text][ref]
  const numericWithoutCaret = /\[(\d+)\](?!\]|\()/g;
  
  // Convert [123] to [^123]
  return content.replace(numericWithoutCaret, '[^$1]');
}

/**
 * Ensure all citations have corresponding footnote definitions
 * @param content - The markdown content
 * @param registry - The citation registry
 * @returns Updated content with all footnote definitions and count of added footnotes
 */
function ensureFootnoteDefinitions(
  content: string,
  registry: CitationRegistry
): {
  updatedContent: string;
  footnotesAdded: number;
} {
  // Find all hex citations
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...content.matchAll(hexCitationRegex)];
  
  let updatedContent = content;
  let footnotesAdded = 0;
  
  // Check each citation for a corresponding footnote definition
  for (const match of hexCitations) {
    const hexId = match[1];
    const footnoteDefRegex = new RegExp(`\\[\\^${hexId}\\]:\\s*(.+)`, 'i');
    
    if (!updatedContent.match(footnoteDefRegex)) {
      // No footnote definition found, add a placeholder
      const citation = registry.getCitation(hexId);
      const placeholderText = citation?.sourceText || 'Citation text needed';
      
      // Add at the end of the document
      updatedContent += `\n\n[^${hexId}]: ${placeholderText}`;
      footnotesAdded++;
    }
  }
  
  return { updatedContent, footnotesAdded };
}

/**
 * Ensures a Footnotes section exists in the content if citations are present
 * @param content - The markdown content
 * @param config - Configuration for the footnotes section
 * @returns Updated content with footnotes section if needed
 */
function ensureFootnotesSection(
  content: string,
  config: {
    footnotesSectionHeader: string;
    footnotesSectionSeparator: string;
  }
): string {
  // Check if any citations exist
  const citationRegex = /\[\^([0-9a-f]+)\]/g;
  const citations = [...content.matchAll(citationRegex)];
  
  if (citations.length === 0) {
    // No citations, no need for a footnotes section
    return content;
  }
  
  // Check if a footnote definition exists
  const footnoteDefRegex = /\[\^([0-9a-f]+)\]:/g;
  const footnoteDefs = [...content.matchAll(footnoteDefRegex)];
  
  if (footnoteDefs.length === 0) {
    // No footnote definitions, no need for a section
    return content;
  }
  
  // Check if a Footnotes section already exists
  const sectionRegex = new RegExp(`${config.footnotesSectionHeader}`, 'i');
  if (content.match(sectionRegex)) {
    // Section already exists
    return content;
  }
  
  // Add footnotes section before the first footnote definition
  const firstFootnoteDef = footnoteDefs[0];
  const firstFootnotePos = content.indexOf(firstFootnoteDef[0]);
  
  // Get the content before and after the first footnote
  const contentBefore = content.substring(0, firstFootnotePos);
  const contentAfter = content.substring(firstFootnotePos);
  
  // Add the footnotes section
  return `${contentBefore}\n\n${config.footnotesSectionHeader}\n\n${config.footnotesSectionSeparator}\n\n${contentAfter}`;
}

/**
 * Safely update the citation registry with backup and error recovery
 * @param registryPath - Path to the registry file
 * @param updateFn - Function to update the registry data
 */
async function safelyUpdateRegistry(
  registryPath: string, 
  updateFn: (data: any) => any
): Promise<void> {
  // Create directory if it doesn't exist
  const dir = path.dirname(registryPath);
  await fs.mkdir(dir, { recursive: true });
  
  // Create backup path
  const backupPath = `${registryPath}.backup`;
  
  try {
    // Check if original file exists
    try {
      await fs.access(registryPath);
      // Create backup if file exists
      await fs.copyFile(registryPath, backupPath);
    } catch (error) {
      // If file doesn't exist, create empty file
      await fs.writeFile(registryPath, '{}', 'utf8');
      await fs.copyFile(registryPath, backupPath);
    }
    
    // Get updated data
    const data = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    const updatedData = updateFn(data);
    
    // Write to temporary file first
    const tempPath = `${registryPath}.temp`;
    await fs.writeFile(tempPath, JSON.stringify(updatedData, null, 2), 'utf8');
    
    // Rename temp file to actual file (atomic operation)
    await fs.rename(tempPath, registryPath);
    
    // Remove backup if successful
    await fs.unlink(backupPath);
  } catch (error) {
    console.error('Error updating registry:', error);
    
    // Restore from backup on error
    try {
      await fs.copyFile(backupPath, registryPath);
    } catch (restoreError) {
      console.error('Failed to restore registry from backup:', restoreError);
    }
    throw error;
  }
}

/**
 * Extract code blocks from content and replace with placeholders
 * @param content - The markdown content
 * @returns Object with processable content and code blocks
 */
function extractCodeBlocks(content: string): {
  processableContent: string;
  codeBlocks: Array<{ placeholder: string; original: string }>;
} {
  const codeBlocks: Array<{ placeholder: string; original: string }> = [];
  let processableContent = content;
  
  // Extract fenced code blocks (```...```)
  const fencedCodeBlockRegex = /```[\s\S]*?```/g;
  let match;
  let index = 0;
  
  while ((match = fencedCodeBlockRegex.exec(content)) !== null) {
    const placeholder = `__CODE_BLOCK_${index}__`;
    codeBlocks.push({
      placeholder,
      original: match[0]
    });
    
    processableContent = processableContent.replace(match[0], placeholder);
    index++;
  }
  
  // Extract indented code blocks (4 spaces or tab at beginning of line)
  // This is more complex and requires line-by-line processing
  const lines = processableContent.split('\n');
  let inIndentedBlock = false;
  let currentBlock = '';
  let startLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isIndented = line.startsWith('    ') || line.startsWith('\t');
    
    if (isIndented && (!inIndentedBlock || (inIndentedBlock && i === startLine + 1))) {
      if (!inIndentedBlock) {
        startLine = i;
        currentBlock = line;
        inIndentedBlock = true;
      } else {
        currentBlock += '\n' + line;
      }
    } else if (inIndentedBlock && (isIndented || line.trim() === '')) {
      currentBlock += '\n' + line;
    } else if (inIndentedBlock) {
      // End of indented block
      const placeholder = `__INDENTED_BLOCK_${index}__`;
      codeBlocks.push({
        placeholder,
        original: currentBlock
      });
      
      processableContent = processableContent.replace(currentBlock, placeholder);
      inIndentedBlock = false;
      currentBlock = '';
      index++;
    }
  }
  
  // Handle case where indented block is at the end of the file
  if (inIndentedBlock) {
    const placeholder = `__INDENTED_BLOCK_${index}__`;
    codeBlocks.push({
      placeholder,
      original: currentBlock
    });
    
    processableContent = processableContent.replace(currentBlock, placeholder);
  }
  
  return { processableContent, codeBlocks };
}

/**
 * Extract inline code from content and replace with placeholders
 * @param content - The markdown content
 * @returns Object with processable content and inline code
 */
function extractInlineCode(content: string): {
  processableContent: string;
  inlineCode: Array<{ placeholder: string; original: string }>;
} {
  const inlineCode: Array<{ placeholder: string; original: string }> = [];
  let processableContent = content;
  
  // Extract inline code (`...`)
  const inlineCodeRegex = /`[^`]+`/g;
  let match;
  let index = 0;
  
  while ((match = inlineCodeRegex.exec(content)) !== null) {
    const placeholder = `__INLINE_CODE_${index}__`;
    inlineCode.push({
      placeholder,
      original: match[0]
    });
    
    processableContent = processableContent.replace(match[0], placeholder);
    index++;
  }
  
  return { processableContent, inlineCode };
}

/**
 * Process citations in a Markdown file
 * @param content - The markdown file content
 * @param filePath - Path to the file
 * @param config - Citation configuration
 * @returns Object with updated content and processing statistics
 */
export async function processCitations(
  content: string,
  filePath: string,
  config: CitationConfig = DEFAULT_CONFIG
): Promise<{
  updatedContent: string;
  changed: boolean;
  stats: {
    citationsConverted: number;
    footnotesAdded: number;
    footnoteSectionAdded: boolean;
  }
}> {
  // Get citation registry
  const citationRegistry = CitationRegistry.getInstance(config);
  
  // Load existing registry
  await citationRegistry.loadFromDisk();
  
  // Extract frontmatter and body
  const frontmatterAndBody = extractFrontmatterAndBody(content);
  
  if (!frontmatterAndBody) {
    return {
      updatedContent: content,
      changed: false,
      stats: {
        citationsConverted: 0,
        footnotesAdded: 0,
        footnoteSectionAdded: false
      }
    };
  }
  
  const { frontmatter, body } = frontmatterAndBody;
  
  // Extract code blocks and replace with placeholders
  const { processableContent: bodyWithoutCodeBlocks, codeBlocks } = extractCodeBlocks(body);
  
  // Extract inline code and replace with placeholders
  const { processableContent: processableBody, inlineCode } = extractInlineCode(bodyWithoutCodeBlocks);
  
  // Only process citations in the non-code content
  
  // Step 1: Fix citation spacing
  const bodyWithFixedSpacing = fixCitationSpacing(processableBody);
  
  // Step 2: Convert citations without carets
  const bodyWithCarets = convertCitationsToCaret(bodyWithFixedSpacing);
  
  // Step 3: Convert numeric citations to hex
  const { updatedContent: bodyWithHexCitations, stats: conversionStats } = 
    convertNumericCitationsToHex(bodyWithCarets, citationRegistry);
  
  // Step 4: Ensure all citations have footnote definitions
  const { updatedContent: bodyWithFootnotes, footnotesAdded } = 
    ensureFootnoteDefinitions(bodyWithHexCitations, citationRegistry);
  
  // Step 5: Ensure Footnotes section exists if needed
  const hadFootnotesSection = bodyWithFootnotes.includes(config.footnotesSectionHeader);
  const bodyWithFootnotesSection = ensureFootnotesSection(bodyWithFootnotes, {
    footnotesSectionHeader: config.footnotesSectionHeader,
    footnotesSectionSeparator: config.footnotesSectionSeparator
  });
  const footnoteSectionAdded = !hadFootnotesSection && 
    bodyWithFootnotesSection.includes(config.footnotesSectionHeader);
  
  // Extract citation text for all hex citations and update registry
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...bodyWithFootnotesSection.matchAll(hexCitationRegex)];
  
  hexCitations.forEach(match => {
    const hexId = match[1];
    const citationText = extractCitationText(bodyWithFootnotesSection, hexId);
    
    if (citationText) {
      citationRegistry.addCitation(hexId, {
        sourceText: citationText,
        files: [filePath]
      });
    }
    
    // Update citation registry with this file
    citationRegistry.updateCitationFiles(hexId, filePath);
  });
  
  // Restore inline code
  let restoredContent = bodyWithFootnotesSection;
  
  // Restore inline code first (reverse order)
  for (let i = inlineCode.length - 1; i >= 0; i--) {
    const { placeholder, original } = inlineCode[i];
    restoredContent = restoredContent.replace(placeholder, original);
  }
  
  // Restore code blocks
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    const { placeholder, original } = codeBlocks[i];
    restoredContent = restoredContent.replace(placeholder, original);
  }
  
  // Update frontmatter with citation information
  const updatedFrontmatter = {
    ...frontmatter,
  };
  
  // Only update date_modified if actual content changes were made
  const contentChanged = restoredContent !== body;
  if (contentChanged) {
    updatedFrontmatter.date_modified = new Date().toISOString().split('T')[0];
  }
  
  // Combine frontmatter and body
  const finalContent = combineFrontmatterAndBody(
    updatedFrontmatter, 
    restoredContent
  );
  
  // Save citation registry
  await citationRegistry.saveToDisk();
  
  return {
    updatedContent: finalContent,
    changed: finalContent !== content,
    stats: {
      citationsConverted: conversionStats.conversionsPerformed,
      footnotesAdded,
      footnoteSectionAdded
    }
  };
}
