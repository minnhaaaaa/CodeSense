import { z } from "zod";
import { GeminiKeyManager } from "@/lib/geminiKeyManager";

export const maxDuration = 60;

// Request schema
const requestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  autoCreatePr: z.boolean().optional().default(false),
});

// Response schema for Gemini
const prSuggestionSchema = z.object({
  prTitle: z.string(),
  prBody: z.string(),
  summary: z.string(),
  issuesFound: z.object({
    codeQuality: z.array(z.string()),
    security: z.array(z.string()),
    redundancy: z.array(z.string()),
    formatting: z.array(z.string()),
  }),
  fileChanges: z.array(z.object({
    path: z.string(),
    action: z.enum(["create", "update", "delete"]),
    content: z.string().nullable(),
    reason: z.string(),
  })),
});

// DeepWiki MCP JSON-RPC call
async function callDeepWikiMcp(toolName: string, args: Record<string, string>): Promise<string> {
  const requestId = `req-${Date.now()}`;
  
  const response = await fetch("https://mcp.deepwiki.com/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepWiki MCP error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`DeepWiki MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  // Extract text content from the response
  const content = data.result?.content;
  if (Array.isArray(content)) {
    return content
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("\n");
  }
  
  return typeof content === "string" ? content : JSON.stringify(content);
}

// Get repository insights from DeepWiki
async function getDeepWikiInsights(owner: string, repo: string): Promise<{
  structure: string;
  overview: string;
  codeQuality: string;
}> {
  const repoName = `${owner}/${repo}`;
  
  console.log("[v0] Fetching DeepWiki insights for:", repoName);
  
  // Fetch insights in parallel
  const [structureResult, overviewResult, codeQualityResult] = await Promise.allSettled([
    callDeepWikiMcp("read_wiki_structure", { repo_name: repoName }),
    callDeepWikiMcp("read_wiki_contents", { repo_name: repoName, topic: "Overview" }),
    callDeepWikiMcp("ask_question", { 
      repo_name: repoName, 
      question: "What are the main code quality issues, potential security vulnerabilities, code duplication, and formatting inconsistencies in this repository? Be specific about file names and line numbers if possible."
    }),
  ]);

  const structure = structureResult.status === "fulfilled" ? structureResult.value : "Unable to fetch structure";
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : "Unable to fetch overview";
  const codeQuality = codeQualityResult.status === "fulfilled" ? codeQualityResult.value : "Unable to analyze code quality";

  console.log("[v0] DeepWiki insights fetched successfully");
  
  return { structure, overview, codeQuality };
}

// Call Gemini for analysis
async function analyzeWithGemini(
  owner: string,
  repo: string,
  deepWikiInsights: { structure: string; overview: string; codeQuality: string }
): Promise<z.infer<typeof prSuggestionSchema>> {
  
  const prompt = `You are an expert code reviewer analyzing the GitHub repository "${owner}/${repo}".

Based on the following DeepWiki analysis, provide a structured PR suggestion to improve the codebase.

## Repository Structure
${deepWikiInsights.structure.substring(0, 2000)}

## Repository Overview  
${deepWikiInsights.overview.substring(0, 2000)}

## Code Quality Analysis
${deepWikiInsights.codeQuality.substring(0, 3000)}

Based on this analysis, provide a JSON response with the following structure:
{
  "prTitle": "A concise PR title describing the main improvements",
  "prBody": "A detailed PR description in markdown format explaining all the changes",
  "summary": "A 2-3 sentence summary of the main issues found and proposed fixes",
  "issuesFound": {
    "codeQuality": ["List of code quality issues found"],
    "security": ["List of security issues found"],
    "redundancy": ["List of code duplication/redundancy issues"],
    "formatting": ["List of formatting/style issues"]
  },
  "fileChanges": [
    {
      "path": "path/to/file.ts",
      "action": "update",
      "content": "Brief description or code snippet of the change (can be null for complex changes)",
      "reason": "Why this change is needed"
    }
  ]
}

Focus on actionable, specific suggestions. If you don't find issues in a category, use an empty array.
Return ONLY valid JSON, no markdown code blocks.`;

  console.log("[v0] Calling Gemini for analysis...");

  const response = await GeminiKeyManager.callWithFallback(async (apiKey) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[v0] Gemini API error:", res.status, errorText);
      throw new Error(`Gemini HTTP error: ${res.status}`);
    }

    return res;
  });

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    console.error("[v0] Gemini returned no content:", JSON.stringify(json));
    throw new Error("Gemini returned no content");
  }

  console.log("[v0] Gemini response received, parsing...");

  // Parse the JSON response
  try {
    // Clean the response - remove markdown code blocks if present
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.slice(7);
    }
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.slice(3);
    }
    if (cleanedText.endsWith("```")) {
      cleanedText = cleanedText.slice(0, -3);
    }
    cleanedText = cleanedText.trim();

    const parsed = JSON.parse(cleanedText);
    return prSuggestionSchema.parse(parsed);
  } catch (parseError) {
    console.error("[v0] Failed to parse Gemini response:", parseError);
    console.error("[v0] Raw response:", text.substring(0, 500));
    
    // Return a fallback structure
    return {
      prTitle: `Code quality improvements for ${owner}/${repo}`,
      prBody: `Based on automated analysis, this PR addresses various code quality issues.\n\n${text.substring(0, 1000)}`,
      summary: "Automated code analysis completed. See details below.",
      issuesFound: {
        codeQuality: ["Analysis completed - see PR body for details"],
        security: [],
        redundancy: [],
        formatting: [],
      },
      fileChanges: [],
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { owner, repo } = requestSchema.parse(body);

    console.log("[v0] Starting audit for:", owner, repo);

    // Step 1: Get DeepWiki insights
    const deepWikiInsights = await getDeepWikiInsights(owner, repo);

    // Step 2: Analyze with Gemini
    const analysis = await analyzeWithGemini(owner, repo, deepWikiInsights);

    console.log("[v0] Audit completed successfully");

    return Response.json({
      success: true,
      analysis,
    });

  } catch (error) {
    console.error("[v0] Audit failed:", error);
    
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    
    return Response.json(
      { 
        success: false, 
        error: message,
      },
      { status: 500 }
    );
  }
}
