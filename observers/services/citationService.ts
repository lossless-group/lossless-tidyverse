/**
 * Citation Service
 * 
 * Processes citations in markdown files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

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
 * @param filePath - The path to the file being processed
 * @returns Object containing updated content and conversion statistics
 */
function convertNumericCitationsToHex(
  content: string,
  registry: CitationRegistry,
  filePath: string
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
      sourceText: citationText,
      files: [filePath]
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
 * Fix spacing around citations (inline only)
 * Ensures exactly one space before citations (unless at line start), and exactly one space after citations (unless followed by space, newline, punctuation, or end of line).
 * Handles multiple adjacent citations, punctuation, and collapses extra spaces.
 * Never alters footnote definition lines.
 * @param content - The markdown content
 * @returns The content with fixed spacing
 */
function fixCitationSpacing(content: string): string {
  // Split content into lines for context-aware processing
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // Only operate on lines that are NOT footnote definitions ([^hex]: ...)
    if (!/^\[\^[0-9a-f]{6}\]:/i.test(lines[i].trim())) {
      // Step 1: Insert a space BEFORE any citation not at start of line or preceded by space
      lines[i] = lines[i].replace(/([^\s]|^)(\[\^[0-9a-f]{6}\])(?!:)/gi, (m, before, citation) => {
        return (before === '' ? '' : before + ' ') + citation;
      });
      // Step 2: Insert a space AFTER any citation not followed by space, newline, punctuation, or end of line
      // This ensures adjacent citations are always separated by a space
      lines[i] = lines[i].replace(/(\[\^[0-9a-f]{6}\])(?!:)(?![ \n.,;:!?]|$)/gi, '$1 ');
      // Step 3: Collapse extra spaces around citations
      lines[i] = lines[i].replace(/ +/g, ' ');
    }
  }
  return lines.join('\n');
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

// --- Removed unused function: safelyUpdateRegistry ---
/**
 * Extract code blocks from content and replace with placeholders
 * @param content - The markdown content
 * @returns Object containing processable content and code blocks
 */
function extractCodeBlocks(content: string): {
  processableContent: string;
  codeBlocks: Array<{ placeholder: string; original: string }>;
} {
  const codeBlocks: Array<{ placeholder: string; original: string }> = [];
  let processableContent = content;
  
  // Extract fenced code blocks (```...```)
  // Use a more robust regex that handles backticks within code blocks
  // This regex matches code blocks with language specifiers and without
  const fencedCodeBlockRegex = /^([ \t]*)```(?:[a-zA-Z0-9_+-]*)\n([\s\S]*?)^[ \t]*```/gm;
  let match;
  let index = 0;
  
  while ((match = fencedCodeBlockRegex.exec(content)) !== null) {
    const placeholder = `__CODE_BLOCK_${index}__`;
    const originalBlock = match[0];
    
    codeBlocks.push({
      placeholder,
      original: originalBlock
    });
    
    // Use a more precise replacement to avoid replacing identical blocks incorrectly
    // Calculate the exact position of this match and replace only at that position
    const matchStart = match.index;
    const matchEnd = matchStart + originalBlock.length;
    const before = processableContent.substring(0, matchStart);
    const after = processableContent.substring(matchEnd);
    processableContent = before + placeholder + after;
    
    // Reset regex lastIndex to account for the replacement
    fencedCodeBlockRegex.lastIndex = before.length + placeholder.length;
    
    index++;
  }
  
  // Extract indented code blocks (4 spaces or tab at beginning of line)
  // This is more complex and requires line-by-line processing
  const lines = processableContent.split('\n');
  let inIndentedBlock = false;
  let currentBlock = '';
  let startLine = 0;
  let blockStartIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isIndented = line.startsWith('    ') || line.startsWith('\t');
    
    if (isIndented && (!inIndentedBlock || (inIndentedBlock && i === startLine + 1))) {
      if (!inIndentedBlock) {
        startLine = i;
        blockStartIndex = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0); // +1 for newline
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
      
      // Use precise replacement
      const blockEndIndex = blockStartIndex + currentBlock.length;
      const before = processableContent.substring(0, blockStartIndex);
      const after = processableContent.substring(blockEndIndex);
      processableContent = before + placeholder + after;
      
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
    
    // Use precise replacement
    const blockEndIndex = blockStartIndex + currentBlock.length;
    const before = processableContent.substring(0, blockStartIndex);
    const after = processableContent.substring(blockEndIndex);
    processableContent = before + placeholder + after;
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
  // Use a more robust regex that handles inline code better
  const inlineCodeRegex = /`([^`]+)`/g;
  let match;
  let index = 0;
  
  while ((match = inlineCodeRegex.exec(content)) !== null) {
    const placeholder = `__INLINE_CODE_${index}__`;
    const originalCode = match[0];
    
    inlineCode.push({
      placeholder,
      original: originalCode
    });
    
    // Use precise replacement to avoid replacing identical inline code incorrectly
    const matchStart = match.index;
    const matchEnd = matchStart + originalCode.length;
    const before = processableContent.substring(0, matchStart);
    const after = processableContent.substring(matchEnd);
    processableContent = before + placeholder + after;
    
    // Reset regex lastIndex to account for the replacement
    inlineCodeRegex.lastIndex = before.length + placeholder.length;
    
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

  // Extract code blocks and replace with placeholders
  const { processableContent: bodyWithoutCodeBlocks, codeBlocks } = extractCodeBlocks(content);

  // Extract inline code and replace with placeholders
  const { processableContent: processableBody, inlineCode } = extractInlineCode(bodyWithoutCodeBlocks);

  // Only process citations in the non-code content

  // Step 1: Convert citations without carets
  const bodyWithCarets = convertCitationsToCaret(processableBody);

  // Step 2: Convert numeric citations to hex
  const { updatedContent: bodyWithHexCitations, stats: conversionStats } = 
    convertNumericCitationsToHex(bodyWithCarets, citationRegistry, filePath);

  // Step 3: Ensure all citations have footnote definitions
  const { updatedContent: bodyWithFootnotes, footnotesAdded } = 
    ensureFootnoteDefinitions(bodyWithHexCitations, citationRegistry);

  // Step 4: Ensure Footnotes section exists if needed
  const hadFootnotesSection = bodyWithFootnotes.includes(config.footnotesSectionHeader);
  const bodyWithFootnotesSection = ensureFootnotesSection(bodyWithFootnotes, {
    footnotesSectionHeader: config.footnotesSectionHeader,
    footnotesSectionSeparator: config.footnotesSectionSeparator
  });
  const footnoteSectionAdded = !hadFootnotesSection && 
    bodyWithFootnotesSection.includes(config.footnotesSectionHeader);

  // Step 5: FIX CITATION SPACING ON FINAL OUTPUT
  let bodyWithFixedSpacing = fixCitationSpacing(bodyWithFootnotesSection);

  // Extract citation text for all hex citations and update registry
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...bodyWithFixedSpacing.matchAll(hexCitationRegex)];

  hexCitations.forEach(match => {
    const hexId = match[1];
    const citationText = extractCitationText(bodyWithFixedSpacing, hexId);

    if (citationText) {
      citationRegistry.addCitation(hexId, {
        sourceText: citationText,
        files: [filePath]
      });
    }

    // Update citation registry with this file
    citationRegistry.updateCitationFiles(hexId, filePath);
  });

  // Restore inline code first (reverse order)
  for (let i = inlineCode.length - 1; i >= 0; i--) {
    const { placeholder, original } = inlineCode[i];
    bodyWithFixedSpacing = bodyWithFixedSpacing.replace(placeholder, original);
  }

  // Restore code blocks
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    const { placeholder, original } = codeBlocks[i];
    bodyWithFixedSpacing = bodyWithFixedSpacing.replace(placeholder, original);
  }

  // Save citation registry
  await citationRegistry.saveToDisk();

  return {
    updatedContent: bodyWithFixedSpacing,
    changed: bodyWithFixedSpacing !== content,
    stats: {
      citationsConverted: conversionStats.conversionsPerformed,
      footnotesAdded,
      footnoteSectionAdded
    }
  };
}
