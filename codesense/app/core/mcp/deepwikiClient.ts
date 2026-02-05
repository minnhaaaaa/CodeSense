export type DeepWikiAnalysis = {
  repoUrl: string;
  summary: string;
  findings: string[];
  /**
   * Indicates this response was produced by the local stub implementation.
   * The real DeepWiki MCP integration should remove or replace this field.
   */
  stub: boolean;
};

import { GeminiKeyManager } from "@/lib/geminiKeyManager";

/**
 * Internal helper: fallback analysis when Gemini API fails
 *
 * This provides a reasonable fallback analysis based on repo name/structure
 * without calling the Gemini API.
 */
async function analyzeWithStub(repoUrl: string): Promise<DeepWikiAnalysis> {
  const trimmedUrl = repoUrl.trim();

  if (!trimmedUrl) {
    throw new Error("Repository URL is required for DeepWiki analysis.");
  }

  // Extract repo name for better fallback analysis
  const repoMatch = trimmedUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  const repoName = repoMatch ? repoMatch[2] : "Repository";

  return {
    repoUrl: trimmedUrl,
    summary:
      `${repoName} is a GitHub repository. Analyze it by exploring its structure, reading the documentation, and examining the main source code files to understand its purpose and architecture.`,
    findings: [
      "Check the README file to understand the project's main goals and setup instructions",
      "Examine the package.json or similar configuration files to identify dependencies and project type",
      "Review the main source directory to understand the codebase structure and key modules",
      "Look for existing issues and pull requests to understand common contribution patterns",
      "Identify the testing setup and contribution guidelines for making improvements",
      "Check for architecture documentation or diagrams that explain the system design",
    ],
    stub: true,
  };
}

/**
 * Live analysis using Gemini directly from the Next.js runtime.
 *
 * This is the primary "real" path when GEMINI_API_KEY is configured. If
 * anything fails (no key, network error, bad response), callers should fall
 * back to the stub implementation.
 */
async function analyzeWithGemini(
  repoUrl: string
): Promise<DeepWikiAnalysis> {
  // Check if we have any API keys
  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GEMINI_API_KEY_BACKUP &&
    !process.env.GEMINI_API_KEY_BACKUP_1 &&
    !process.env.GEMINI_API_KEY_BACKUP_2
  ) {
    throw new Error("No Gemini API keys configured");
  }

  // Extract owner/repo from URL
  const urlParts = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!urlParts) {
    throw new Error("Invalid GitHub repository URL");
  }

  const [_, owner, repo] = urlParts;

  // Try to fetch some actual code to provide context
  let codeContext = "";
  try {
    // Fetch README
    const readmeUrl = `https://api.github.com/repos/${owner}/${repo}/readme`;
    const readmeRes = await fetch(readmeUrl);
    if (readmeRes.ok) {
      const readmeData = (await readmeRes.json()) as any;
      const readmeContent = Buffer.from(readmeData.content || "", "base64").toString("utf-8");
      codeContext += `README:\n${readmeContent.substring(0, 500)}\n\n`;
    }

    // Fetch package.json or similar
    const pkgUrl = `https://api.github.com/repos/${owner}/${repo}/contents/package.json`;
    const pkgRes = await fetch(pkgUrl);
    if (pkgRes.ok) {
      const pkgData = (await pkgRes.json()) as any;
      const pkgContent = Buffer.from(pkgData.content || "", "base64").toString("utf-8");
      codeContext += `package.json:\n${pkgContent.substring(0, 300)}\n\n`;
    }
  } catch {
    // Ignore fetch errors, we'll work with what we have
  }

  const prompt = [
    "You are helping a developer understand a GitHub repository and plan contributions.",
    `Repository URL: ${repoUrl}`,
    `Repository: ${owner}/${repo}`,
    "",
    codeContext ? `Project Information:\n${codeContext}` : "",
    "",
    "Analyze this repository based on its structure and available information.",
    "Return a comprehensive summary (2–4 sentences) explaining what this project does and its main purpose.",
    "Then provide 4–6 concrete, specific contribution ideas or improvement areas.",
    "Format: Start with the summary, then list ideas with bullet points starting with '-'",
  ].join("\n");

  // Use key manager with fallback - it will automatically try all keys
  const response = await GeminiKeyManager.callWithFallback(async (apiKey) => {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini HTTP error: ${res.status}`);
    }

    return res;
  });

  const json = (await response.json()) as any;
  const text: string =
    json?.candidates?.[0]?.content?.parts?.[0]?.text ??
    "Gemini did not return any content.";

  const lines = text.split("\n").map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);

  // First non-empty line is the summary
  const summary = nonEmpty[0] ?? "No summary generated.";
  
  // Find lines that are actual findings (start with - or *, or are numbered)
  const findings: string[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    // Skip lines that look like headers or instructions
    if (
      line.startsWith("-") ||
      line.startsWith("*") ||
      /^\d+\./.test(line) ||
      line.startsWith("**")
    ) {
      // Clean the line and add it
      const cleaned = line
        .replace(/^[\-*\d.]\s*/, "") // Remove list markers and numbers
        .replace(/^\*\*/, "") // Remove ** prefix
        .replace(/\*\*:?\s*/, ""); // Remove ** suffix
      if (cleaned.length > 0 && !cleaned.toLowerCase().includes("here are")) {
        findings.push(cleaned);
      }
    }
  }

  return {
    repoUrl,
    summary,
    findings,
    stub: false,
  };
}

/**
 * Core DeepWiki entrypoint used by the app.
 *
 * Modes:
 * 1. Gemini live mode (preferred): if GEMINI_API_KEY is set, we call the
 *    Gemini HTTP API directly for a live, model-powered analysis.
 * 2. Stub mode (fallback): if GEMINI_API_KEY is missing or any live call
 *    fails, we fall back to the local stub so the UI always has data.
 *
 * The function name, input type, and output fields are preserved so that
 * callers and UI components do not need to change as we upgrade the backend.
 */
export async function analyzeRepositoryWithDeepWiki(
  repoUrl: string
): Promise<DeepWikiAnalysis> {
  const trimmedUrl = repoUrl.trim();

  if (!trimmedUrl) {
    throw new Error("Repository URL is required for DeepWiki analysis.");
  }

  try {
    // Preferred path: live Gemini-backed analysis.
    return await analyzeWithGemini(trimmedUrl);
  } catch (error) {
    // Any configuration or network error should not break the app; we degrade
    // gracefully to the local stub.
    // eslint-disable-next-line no-console
    console.error("[DeepWiki] Live mode error, falling back to stub:", error);
    return analyzeWithStub(trimmedUrl);
  }
}

