/**
 * POST /api/audit
 * 
 * Agentic PR Suggestor API Route
 * 
 * This route:
 * 1. Accepts repo and owner parameters
 * 2. Uses DeepWiki analysis to get code insights
 * 3. Sends insights to Gemini for structured analysis
 * 4. Returns structured JSON with PR title, body, and file changes
 */

import { analyzeRepositoryWithDeepWiki } from "@/app/core/mcp/deepwikiClient";
import { buildFileTree } from "@/lib/github";
import { fetchCodeContext, guessSourceFiles } from "@/lib/githubFiles";
import { GeminiKeyManager } from "@/lib/geminiKeyManager";
import { z } from "zod";

// Request body schema
const requestSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repo is required"),
  autoCreatePr: z.boolean().optional().default(false),
});

// Schema for the structured PR suggestion output
const prSuggestionSchema = z.object({
  prTitle: z.string(),
  prBody: z.string(),
  fileChanges: z.array(z.object({
    path: z.string(),
    action: z.enum(["create", "update", "delete"]),
    content: z.string().nullable(),
    reason: z.string(),
  })),
  summary: z.string(),
  issuesFound: z.object({
    codeQuality: z.array(z.string()),
    security: z.array(z.string()),
    redundancy: z.array(z.string()),
    formatting: z.array(z.string()),
  }),
});

type PrSuggestion = z.infer<typeof prSuggestionSchema>;

export async function POST(request: Request) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validationResult = requestSchema.safeParse(body);

    if (!validationResult.success) {
      return Response.json(
        { 
          error: "Invalid request body", 
          details: validationResult.error.flatten() 
        },
        { status: 400 }
      );
    }

    const { owner, repo } = validationResult.data;
    const repoUrl = `https://github.com/${owner}/${repo}`;

    // Step 1: Get DeepWiki analysis
    console.log(`[Audit] Analyzing repository ${owner}/${repo}...`);
    
    const deepWikiAnalysis = await analyzeRepositoryWithDeepWiki(repoUrl);

    // Step 2: Fetch actual code context for better analysis
    let codeContext = "";
    let fileList: string[] = [];
    
    try {
      const fileTree = await buildFileTree(owner, repo, "", 0, 2);
      const filePaths = guessSourceFiles(fileTree, owner, repo);
      const context = await fetchCodeContext(owner, repo, filePaths);
      
      fileList = Object.keys(context.fileContents);
      codeContext = `\n\nFiles analyzed: ${fileList.join(", ")}\n`;

      // Include code snippets from multiple files for better context
      const entries = Object.entries(context.fileContents).slice(0, 3);
      for (const [filename, content] of entries) {
        const snippet = content.substring(0, 800);
        codeContext += `\n--- ${filename} ---\n\`\`\`\n${snippet}\n...\n\`\`\`\n`;
      }
    } catch (err) {
      console.error("[Audit] Error fetching code context:", err);
      // Continue without code context
    }

    // Step 3: Build comprehensive prompt for Gemini
    const analysisPrompt = `You are an expert code reviewer and security analyst. Analyze the following repository and provide structured suggestions for improving the codebase.

Repository: ${owner}/${repo}
Repository URL: ${repoUrl}

## Repository Analysis
Summary: ${deepWikiAnalysis.summary}

Key Findings:
${deepWikiAnalysis.findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

${codeContext}

---

Based on this analysis, provide a JSON response with the following structure:
{
  "prTitle": "A concise, descriptive title for a pull request that summarizes the main improvements",
  "prBody": "Detailed description of all changes in Markdown format",
  "fileChanges": [
    {
      "path": "path/to/file.ts",
      "action": "update",
      "content": "The suggested new content or null for deletions",
      "reason": "Brief explanation of why this change is needed"
    }
  ],
  "summary": "Brief 1-2 sentence summary of the audit findings",
  "issuesFound": {
    "codeQuality": ["List of code quality issues found"],
    "security": ["List of security issues found"],
    "redundancy": ["List of redundancy/duplication issues found"],
    "formatting": ["List of formatting issues found"]
  }
}

Focus on finding:
- Code duplicacy and redundancy
- Formatting and style consistency issues
- Security vulnerabilities and unsafe patterns
- Performance improvements
- Best practices violations

If no issues are found in a category, use an empty array.
Only suggest concrete, actionable file changes that would meaningfully improve the codebase.
Return ONLY valid JSON, no additional text.`;

    // Step 4: Call Gemini for structured analysis
    console.log("[Audit] Generating suggestions with Gemini...");

    const geminiResponse = await GeminiKeyManager.callWithFallback(async (apiKey) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: analysisPrompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini API error: ${res.status} - ${errorText}`);
      }

      return res;
    });

    const geminiJson = await geminiResponse.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const responseText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      throw new Error("Gemini returned empty response");
    }

    // Step 5: Parse and validate the response
    let prSuggestion: PrSuggestion;
    
    try {
      // Clean the response text (remove markdown code blocks if present)
      let cleanedText = responseText.trim();
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
      prSuggestion = prSuggestionSchema.parse(parsed);
    } catch (parseError) {
      console.error("[Audit] Failed to parse Gemini response:", parseError);
      console.error("[Audit] Raw response:", responseText);
      
      // Provide a fallback response based on DeepWiki analysis
      prSuggestion = {
        prTitle: `Improve ${repo} based on code analysis`,
        prBody: `## Summary\n\n${deepWikiAnalysis.summary}\n\n## Findings\n\n${deepWikiAnalysis.findings.map(f => `- ${f}`).join("\n")}`,
        fileChanges: [],
        summary: deepWikiAnalysis.summary,
        issuesFound: {
          codeQuality: deepWikiAnalysis.findings.slice(0, 2),
          security: [],
          redundancy: [],
          formatting: [],
        },
      };
    }

    // Step 6: Return the response
    const response = {
      success: true,
      analysis: prSuggestion,
    };

    return Response.json(response);
  } catch (error) {
    console.error("[Audit] Unexpected error:", error);
    
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: "Audit failed", details: message },
      { status: 500 }
    );
  }
}
