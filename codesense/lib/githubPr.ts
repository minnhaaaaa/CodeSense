/**
 * GitHub PR Operations
 * Handles branch creation and PR operations using Octokit
 */

import { Octokit } from "octokit";

export interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
  content?: string;
}

export interface PrResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
}

/**
 * Get Octokit instance with GitHub token
 */
function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }
  return new Octokit({ auth: token });
}

/**
 * Get the default branch of a repository
 */
async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return data.default_branch;
}

/**
 * Get the latest commit SHA of a branch
 */
async function getLatestCommitSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const { data } = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch,
  });
  return data.commit.sha;
}

/**
 * Create a new branch from the default branch
 */
export async function createBranch(
  owner: string,
  repo: string,
  branchName: string
): Promise<string> {
  const octokit = getOctokit();
  const defaultBranch = await getDefaultBranch(octokit, owner, repo);
  const baseSha = await getLatestCommitSha(octokit, owner, repo, defaultBranch);

  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (error: unknown) {
    // Branch might already exist, try to update it
    const isGitHubError = error instanceof Error && "status" in error;
    if (isGitHubError && (error as { status: number }).status === 422) {
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
        sha: baseSha,
        force: true,
      });
    } else {
      throw error;
    }
  }

  return branchName;
}

/**
 * Get the current content and SHA of a file (if it exists)
 */
async function getFileInfo(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ sha: string; content: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if ("sha" in data && "content" in data) {
      return {
        sha: data.sha,
        content: Buffer.from(data.content, "base64").toString("utf-8"),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Commit file changes to a branch
 */
export async function commitFileChanges(
  owner: string,
  repo: string,
  branchName: string,
  fileChanges: FileChange[],
  commitMessage: string
): Promise<string> {
  const octokit = getOctokit();

  // Get the current commit SHA
  const currentSha = await getLatestCommitSha(octokit, owner, repo, branchName);

  // Get the tree SHA from the current commit
  const { data: currentCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: currentSha,
  });
  const baseTreeSha = currentCommit.tree.sha;

  // Build tree entries for each file change
  const treeEntries = await Promise.all(
    fileChanges.map(async (change) => {
      if (change.action === "delete") {
        // For deletion, we need to check if file exists first
        const existingFile = await getFileInfo(
          octokit,
          owner,
          repo,
          change.path,
          branchName
        );
        if (!existingFile) {
          return null; // File doesn't exist, skip
        }
        return {
          path: change.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: null, // null SHA means delete
        };
      }

      // For create/update, create a blob with the content
      const { data: blob } = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: change.content || "",
        encoding: "utf-8",
      });

      return {
        path: change.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    })
  );

  // Filter out null entries (files that don't exist for deletion)
  const validTreeEntries = treeEntries.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null
  );

  if (validTreeEntries.length === 0) {
    throw new Error("No valid file changes to commit");
  }

  // Create a new tree
  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: validTreeEntries,
  });

  // Create a new commit
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: [currentSha],
  });

  // Update the branch reference
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  });

  return newCommit.sha;
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  body: string
): Promise<PrResult> {
  const octokit = getOctokit();
  const defaultBranch = await getDefaultBranch(octokit, owner, repo);

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branchName,
    base: defaultBranch,
  });

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
    branchName,
  };
}

/**
 * Full workflow: create branch, commit changes, and open PR
 */
export async function createPrWithChanges(
  owner: string,
  repo: string,
  fileChanges: FileChange[],
  prTitle: string,
  prBody: string
): Promise<PrResult> {
  // Generate a unique branch name
  const timestamp = new Date().toISOString().split("T")[0];
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const branchName = `codesense/audit-${timestamp}-${randomSuffix}`;

  // Create the branch
  await createBranch(owner, repo, branchName);

  // Commit file changes if any
  if (fileChanges.length > 0) {
    await commitFileChanges(
      owner,
      repo,
      branchName,
      fileChanges,
      `CodeSense: ${prTitle}`
    );
  }

  // Create the pull request
  return createPullRequest(owner, repo, branchName, prTitle, prBody);
}
