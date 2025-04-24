/**
 * Processed Files Tracker
 * 
 * A centralized utility for tracking which files have been processed by the observer system.
 * This prevents infinite loops and duplicate processing while ensuring proper state management
 * across process restarts.
 * 
 * The tracker uses a singleton pattern to ensure there's only one instance tracking files
 * across the entire application, regardless of how many components access it.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Information about a processed file
 */
interface ProcessedFileInfo {
  // When the file was processed
  timestamp: number;
  // Optional content hash for detecting actual changes
  hash?: string;
}

/**
 * Singleton class for tracking processed files across the application
 */
class ProcessedFilesTracker {
  // Singleton instance
  private static instance: ProcessedFilesTracker;

  // Map to track processed files with timestamps
  private processedFiles = new Map<string, ProcessedFileInfo>();
  
  // Configurable expiration time (default: 5 minutes)
  private expirationMs = 5 * 60 * 1000;
  
  // File to persist processed state (optional)
  private stateFilePath: string;
  private persistStateToFile: boolean;
  
  // Critical files that should always be processed regardless of tracking
  private criticalFiles: string[] = [];
  
  // Flag to track if the tracker has been initialized
  private initialized = false;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Default state file path in the same directory as this module
    this.stateFilePath = path.join(__dirname, '.observer-state.json');
    this.persistStateToFile = process.env.PERSIST_OBSERVER_STATE === 'true';
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ProcessedFilesTracker {
    if (!ProcessedFilesTracker.instance) {
      ProcessedFilesTracker.instance = new ProcessedFilesTracker();
    }
    return ProcessedFilesTracker.instance;
  }

  /**
   * Initialize the tracker
   * @param options Configuration options
   */
  public initialize(options?: {
    expirationMs?: number;
    stateFilePath?: string;
    persistStateToFile?: boolean;
    criticalFiles?: string[];
  }): void {
    if (this.initialized) {
      console.log('[ProcessedFilesTracker] Already initialized, skipping');
      return;
    }

    // Apply options if provided
    if (options) {
      if (options.expirationMs) this.expirationMs = options.expirationMs;
      if (options.stateFilePath) this.stateFilePath = options.stateFilePath;
      if (options.persistStateToFile !== undefined) this.persistStateToFile = options.persistStateToFile;
      if (options.criticalFiles) this.criticalFiles = options.criticalFiles.map(f => f.toLowerCase());
    }

    console.log('[ProcessedFilesTracker] Initializing with the following configuration:');
    console.log(`  - Expiration time: ${this.expirationMs}ms`);
    console.log(`  - State file path: ${this.stateFilePath}`);
    console.log(`  - Persist state to file: ${this.persistStateToFile}`);
    console.log(`  - Critical files: ${this.criticalFiles.join(', ') || 'None'}`);

    // Reset the processed files set to ensure a clean start
    this.reset();

    // Load state from file if persistence is enabled
    if (this.persistStateToFile) {
      this.loadStateFromFile();
    }

    this.initialized = true;
    console.log('[ProcessedFilesTracker] Initialization complete');
  }

  /**
   * Reset the processed files tracking
   */
  public reset(): void {
    console.log('[ProcessedFilesTracker] Resetting processed files tracking');
    this.processedFiles.clear();
    console.log('[ProcessedFilesTracker] Processed files tracking reset complete. Set size: 0');
  }

  /**
   * Mark a file as processed
   * @param filePath Path to the file to mark as processed
   * @param generateHash Whether to generate a content hash for the file
   */
  public markAsProcessed(filePath: string, generateHash: boolean = false): void {
    // Special case: If filePath is 'RESET', reset the processed files set
    if (filePath === 'RESET') {
      console.log('[ProcessedFilesTracker] Received RESET signal');
      this.reset();
      return;
    }

    const fileInfo: ProcessedFileInfo = {
      timestamp: Date.now()
    };

    // Generate content hash if requested
    if (generateHash) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        fileInfo.hash = crypto.createHash('md5').update(content).digest('hex');
      } catch (error) {
        console.warn(`[ProcessedFilesTracker] Error generating hash for ${filePath}:`, error);
      }
    }

    this.processedFiles.set(filePath, fileInfo);
    
    // Log periodically to avoid excessive output
    if (this.processedFiles.size % 10 === 0) {
      console.log(`[ProcessedFilesTracker] Total processed files: ${this.processedFiles.size}`);
    }

    // Persist state to file if enabled
    if (this.persistStateToFile) {
      this.saveStateToFile();
    }
  }

  /**
   * Check if a file should be processed
   * @param filePath Path to the file to check
   * @param forceProcess Force processing regardless of tracking status
   * @returns True if the file should be processed, false otherwise
   */
  public shouldProcess(filePath: string, forceProcess: boolean = false): boolean {
    // Always process if force flag is set
    if (forceProcess) {
      console.log(`[ProcessedFilesTracker] Force processing enabled for ${filePath}`);
      return true;
    }

    // Always process critical files
    const fileName = path.basename(filePath).toLowerCase();
    if (this.criticalFiles.includes(fileName)) {
      console.log(`[ProcessedFilesTracker] Critical file detected: ${filePath}, will process`);
      return true;
    }
    
    // Check if file exists in processed set
    const fileInfo = this.processedFiles.get(filePath);
    if (!fileInfo) {
      return true; // File not processed before
    }
    
    // Check if the entry has expired
    const now = Date.now();
    if (now - fileInfo.timestamp > this.expirationMs) {
      console.log(`[ProcessedFilesTracker] Processing entry for ${filePath} has expired, will process again`);
      return true;
    }
    
    console.log(`[ProcessedFilesTracker] File ${filePath} was processed recently. Skipping.`);
    return false;
  }

  /**
   * Add a critical file that should always be processed
   * @param fileName Name of the file (without path)
   */
  public addCriticalFile(fileName: string): void {
    const normalizedName = fileName.toLowerCase();
    if (!this.criticalFiles.includes(normalizedName)) {
      this.criticalFiles.push(normalizedName);
      console.log(`[ProcessedFilesTracker] Added critical file: ${fileName}`);
    }
  }

  /**
   * Load state from file if persistence is enabled
   */
  private loadStateFromFile(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf8');
        const state = JSON.parse(data);
        
        // Convert the loaded state back to a Map
        this.processedFiles = new Map(Object.entries(state.processedFiles));
        console.log(`[ProcessedFilesTracker] Loaded ${this.processedFiles.size} processed file entries from state file`);
      }
    } catch (error) {
      console.error('[ProcessedFilesTracker] Error loading state from file:', error);
    }
  }

  /**
   * Save state to file if persistence is enabled
   */
  private saveStateToFile(): void {
    try {
      // Convert Map to a plain object for JSON serialization
      const state = {
        processedFiles: Object.fromEntries(this.processedFiles)
      };
      
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
      console.log(`[ProcessedFilesTracker] Saved ${this.processedFiles.size} processed file entries to state file`);
    } catch (error) {
      console.error('[ProcessedFilesTracker] Error saving state to file:', error);
    }
  }

  /**
   * Shutdown the tracker
   */
  public shutdown(): void {
    console.log('[ProcessedFilesTracker] Shutting down');
    
    // Log the number of processed files
    console.log(`[ProcessedFilesTracker] Number of processed files at shutdown: ${this.processedFiles.size}`);
    
    // Persist state to file if enabled
    if (this.persistStateToFile) {
      this.saveStateToFile();
    }
    
    // Reset the processed files set to ensure a clean state for the next run
    this.reset();
    
    console.log('[ProcessedFilesTracker] Shutdown complete');
  }

  /**
   * Get the current count of processed files
   */
  public getProcessedFilesCount(): number {
    return this.processedFiles.size;
  }
}

// Export singleton instance
export const processedFilesTracker = ProcessedFilesTracker.getInstance();

// Export convenience functions
export const initializeProcessedFilesTracker = (options?: {
  expirationMs?: number;
  stateFilePath?: string;
  persistStateToFile?: boolean;
  criticalFiles?: string[];
}) => processedFilesTracker.initialize(options);

export const markFileAsProcessed = (filePath: string, generateHash: boolean = false) => 
  processedFilesTracker.markAsProcessed(filePath, generateHash);

export const shouldProcessFile = (filePath: string, forceProcess: boolean = false) => 
  processedFilesTracker.shouldProcess(filePath, forceProcess);

export const resetProcessedFilesTracker = () => 
  processedFilesTracker.reset();

export const shutdownProcessedFilesTracker = () => 
  processedFilesTracker.shutdown();

export const addCriticalFile = (fileName: string) => 
  processedFilesTracker.addCriticalFile(fileName);
