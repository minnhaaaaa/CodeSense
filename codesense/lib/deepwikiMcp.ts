/**
 * DeepWiki MCP Client
 * Handles JSON-RPC communication with DeepWiki MCP endpoint
 */

const DEEPWIKI_MCP_ENDPOINT = "https://mcp.deepwiki.com/mcp";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: {
    content?: Array<{
      type: string;
      text?: string;
    }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface WikiStructureTopic {
  id: string;
  label: string;
  children?: WikiStructureTopic[];
}

export interface WikiStructureResult {
  topics: WikiStructureTopic[];
}

export interface WikiContentsResult {
  content: string;
}

export interface AskQuestionResult {
  answer: string;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Make a JSON-RPC call to DeepWiki MCP endpoint
 */
async function callDeepWikiMcp<T>(
  toolName: string,
  args: Record<string, unknown>
): Promise<T> {
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: generateRequestId(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const response = await fetch(DEEPWIKI_MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`DeepWiki MCP error: ${response.status} ${response.statusText}`);
  }

  const jsonResponse: JsonRpcResponse = await response.json();

  if (jsonResponse.error) {
    throw new Error(`DeepWiki MCP error: ${jsonResponse.error.message}`);
  }

  if (jsonResponse.result?.isError) {
    const errorText = jsonResponse.result.content?.[0]?.text || "Unknown error";
    throw new Error(`DeepWiki tool error: ${errorText}`);
  }

  // Extract text content from the response
  const textContent = jsonResponse.result?.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  if (!textContent) {
    throw new Error("DeepWiki MCP returned empty response");
  }

  // Try to parse as JSON, otherwise return as string
  try {
    return JSON.parse(textContent) as T;
  } catch {
    return textContent as T;
  }
}

/**
 * Get the wiki structure (documentation topics) for a repository
 */
export async function getWikiStructure(
  repoName: string
): Promise<WikiStructureTopic[]> {
  const result = await callDeepWikiMcp<WikiStructureResult | string>(
    "read_wiki_structure",
    { repo_name: repoName }
  );

  if (typeof result === "string") {
    // Parse structure from text if not JSON
    return [{ id: "root", label: result }];
  }

  return result.topics || [];
}

/**
 * Get wiki contents for a specific topic
 */
export async function getWikiContents(
  repoName: string,
  topic?: string
): Promise<string> {
  const result = await callDeepWikiMcp<WikiContentsResult | string>(
    "read_wiki_contents",
    {
      repo_name: repoName,
      ...(topic && { topic }),
    }
  );

  if (typeof result === "string") {
    return result;
  }

  return result.content || "";
}

/**
 * Ask a question about a repository and get AI-powered response
 */
export async function askQuestion(
  repoName: string,
  question: string
): Promise<string> {
  const result = await callDeepWikiMcp<AskQuestionResult | string>(
    "ask_question",
    {
      repo_name: repoName,
      question,
    }
  );

  if (typeof result === "string") {
    return result;
  }

  return result.answer || "";
}

/**
 * Get comprehensive code analysis insights for PR suggestions
 */
export async function getCodeInsights(
  owner: string,
  repo: string
): Promise<{
  overview: string;
  codeQuality: string;
  securityAnalysis: string;
  suggestions: string;
}> {
  const repoName = `${owner}/${repo}`;

  // Fetch multiple insights in parallel for comprehensive analysis
  const [overview, codeQuality, securityAnalysis, suggestions] = await Promise.all([
    askQuestion(
      repoName,
      "Provide a brief overview of this repository's architecture and main components. Focus on the code structure and patterns used."
    ).catch(() => "Unable to fetch repository overview."),
    
    askQuestion(
      repoName,
      "Analyze the code quality in this repository. Look for code duplicacy, redundancy, and formatting issues. List specific files and patterns that could be improved."
    ).catch(() => "Unable to analyze code quality."),
    
    askQuestion(
      repoName,
      "Perform a security analysis of this repository. Look for potential security vulnerabilities, unsafe patterns, hardcoded secrets, and areas that need security improvements."
    ).catch(() => "Unable to perform security analysis."),
    
    askQuestion(
      repoName,
      "What are the top improvement suggestions for this codebase? Focus on actionable changes that would improve code quality, performance, and maintainability."
    ).catch(() => "Unable to fetch improvement suggestions."),
  ]);

  return {
    overview,
    codeQuality,
    securityAnalysis,
    suggestions,
  };
}
