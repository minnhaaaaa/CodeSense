/**
 * POST /api/audit
 * 
 * Agentic PR Suggestor API Route
 * 
 * This route:
 * 1. Accepts repo and owner parameters
 * 2. Calls DeepWiki MCP endpoint to get code insights
 * 3. Sends insights to Gemini 1.5 Flash for analysis
 * 4. Parses the response as structured JSON with PR title, body, and file changes
 * 5. Uses Octokit to create a branch and open a PR on GitHub
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getCodeInsights } from "@/lib/deepwikiMcp";
import { createPrWithChanges, FileChange, PrResult } from "@/lib/githubPr";

// Schema for file changes in the PR
const fileChangeSchema = z.object({
  path: z.string().describe("The file path relative to the repository root"),
  action: z.enum(["create", "update", "delete"]).describe("The type of change to make"),
  content: z.string().nullable().describe("The new content of the file (null for deletions)"),
  reason: z.string().describe("Brief explanation of why this change is needed"),
});

// Schema for the structured PR suggestion output
const prSuggestionSchema = z.object({
  prTitle: z.string().describe("A concise, descriptive title for the pull request"),
  prBody: z.string().describe("Detailed description of the changes, formatted in Markdown"),
  fileChanges: z.array(fileChangeSchema).describe("List of file changes to make"),
  summary: z.string().describe("Brief summary of the audit findings"),
  issuesFound: z.object({
    codeQuality: z.array(z.string()).describe("Code quality issues found"),
    security: z.array(z.string()).describe("Security issues found"),
    redundancy: z.array(z.string()).describe("Redundancy and duplication issues found"),
    formatting: z.array(z.string()).describe("Formatting issues found"),
  }),
});

type PrSuggestion = z.infer<typeof prSuggestionSchema>;

// Request body schema
const requestSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repo is required"),
  autoCreatePr: z.boolean().optional().default(false),
});

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

    const { owner, repo, autoCreatePr } = validationResult.data;

    // Step 1: Get code insights from DeepWiki MCP
    console.log(`[Audit] Fetching code insights for ${owner}/${repo}...`);
    
    let codeInsights;
    try {
      codeInsights = await getCodeInsights(owner, repo);
    } catch (error) {
      console.error("[Audit] DeepWiki MCP error:", error);
      // Provide fallback insights if DeepWiki fails
      codeInsights = {
        overview: `Repository: ${owner}/${repo}`,
        codeQuality: "Unable to fetch detailed code quality analysis. Please ensure the repository is public and accessible.",
        securityAnalysis: "Unable to perform security analysis. Manual review recommended.",
        suggestions: "Consider running local linting and security tools for a comprehensive analysis.",
      };
    }

    // Step 2: Send insights to Gemini for structured analysis
    console.log("[Audit] Analyzing with Gemini...");

    const analysisPrompt = `You are an expert code reviewer and security analyst. Analyze the following repository insights and provide detailed, actionable suggestions for improving the codebase.

Repository: ${owner}/${repo}

## Repository Overview
${codeInsights.overview}

## Code Quality Analysis
${codeInsights.codeQuality}

## Security Analysis
${codeInsights.securityAnalysis}

## Improvement Suggestions
${codeInsights.suggestions}

---

Based on this analysis, provide:
1. A clear, descriptive PR title that summarizes the main improvements
2. A detailed PR body in Markdown format explaining all the changes
3. Specific file changes with the actual code modifications needed
4. A categorized list of all issues found (code quality, security, redundancy, formatting)

Focus on:
- Code duplicacy and redundancy
- Formatting and style consistency
- Security vulnerabilities and unsafe patterns
- Performance improvements
- Best practices and maintainability

For file changes, provide complete, working code that can be directly committed. Only suggest changes that will meaningfully improve the codebase.`;

    const { output } = await generateText({
      model: "google/gemini-1.5-flash",
      output: Output.object({
        schema: prSuggestionSchema,
      }),
      prompt: analysisPrompt,
    });

    if (!output) {
      return Response.json(
        { error: "Failed to generate PR suggestions" },
        { status: 500 }
      );
    }

    const prSuggestion: PrSuggestion = output;

    // Step 3: Optionally create the PR on GitHub
    let prResult: PrResult | null = null;

    if (autoCreatePr && prSuggestion.fileChanges.length > 0) {
      console.log("[Audit] Creating PR on GitHub...");
      
      try {
        // Convert file changes to the format expected by githubPr
        const fileChanges: FileChange[] = prSuggestion.fileChanges.map((change) => ({
          path: change.path,
          action: change.action,
          content: change.content || undefined,
        }));

        prResult = await createPrWithChanges(
          owner,
          repo,
          fileChanges,
          prSuggestion.prTitle,
          prSuggestion.prBody
        );

        console.log(`[Audit] PR created: ${prResult.prUrl}`);
      } catch (error) {
        console.error("[Audit] Failed to create PR:", error);
        // Continue without PR creation, return the suggestions
      }
    }

    // Step 4: Return the response
    const response = {
      success: true,
      analysis: {
        prTitle: prSuggestion.prTitle,
        prBody: prSuggestion.prBody,
        fileChanges: prSuggestion.fileChanges,
        summary: prSuggestion.summary,
        issuesFound: prSuggestion.issuesFound,
      },
      ...(prResult && {
        pr: {
          url: prResult.prUrl,
          number: prResult.prNumber,
          branch: prResult.branchName,
        },
      }),
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
