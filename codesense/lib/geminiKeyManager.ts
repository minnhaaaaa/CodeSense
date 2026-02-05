/**
 * Gemini API Key Manager
 * Handles multiple API keys with automatic fallback
 */

export class GeminiKeyManager {
  private static keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_BACKUP,
    process.env.GEMINI_API_KEY_BACKUP_1,
    process.env.GEMINI_API_KEY_BACKUP_2,
    process.env.GEMINI_API_KEY_BACKUP_3,
  ].filter(Boolean) as string[];

  private static currentKeyIndex = 0;

  /**
   * Get current API key
   */
  static getCurrentKey(): string | null {
    if (this.keys.length === 0) return null;
    return this.keys[this.currentKeyIndex];
  }

  /**
   * Get next API key (for fallback)
   */
  static getNextKey(): string | null {
    if (this.keys.length === 0) return null;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
    return this.keys[this.currentKeyIndex];
  }

  /**
   * Try a Gemini API call with automatic key rotation on failure
   */
  static async callWithFallback<T>(
    makeRequest: (key: string) => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;
    const keyCount = this.keys.length;

    if (keyCount === 0) {
      throw new Error("No Gemini API keys configured");
    }

    // Try each key
    for (let i = 0; i < keyCount; i++) {
      try {
        const key = this.getCurrentKey();
        if (!key) {
          throw new Error("No Gemini API keys configured");
        }

        console.log(`[Gemini] Trying key ${i + 1}/${keyCount}...`);
        const result = await makeRequest(key);
        console.log(`[Gemini] Key ${i + 1}/${keyCount} succeeded!`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = lastError.message || "Unknown error";
        console.warn(
          `[Gemini] Key ${i + 1}/${keyCount} failed: ${errorMsg}`
        );

        // Try next key
        this.getNextKey();

        // If this is the last key, don't try again
        if (i === keyCount - 1) {
          console.error(
            `[Gemini] All ${keyCount} API keys failed. Using fallback.`
          );
        }
      }
    }

    // All keys failed - throw error so caller can handle fallback
    const finalError = new Error(
      `All ${keyCount} Gemini API keys failed. Last error: ${lastError?.message || "unknown"}`
    );
    throw finalError;
  }

  /**
   * Get all configured keys count
   */
  static getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Reset to first key
   */
  static reset(): void {
    this.currentKeyIndex = 0;
  }
}
