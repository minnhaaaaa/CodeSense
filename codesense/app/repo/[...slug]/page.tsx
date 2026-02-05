"use client"

import React from "react"
import { useParams } from "next/navigation"
import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, BookOpen, FolderTree, MessageSquare, Loader2, ExternalLink, RefreshCw, GitBranch, Lightbulb, AlertTriangle, FileCode, Shield, Code2, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RepoSearchBar } from "@/components/RepoSearchBar"
import { FileStructure } from "@/components/FileStructure"
import { MermaidDiagram } from "@/components/MermaidDiagram"

interface AnalysisState {
  status: "idle" | "loading" | "streaming" | "complete" | "error"
  analysis: string
  error: string | null
}

interface FileTreeNode {
  name: string
  type: "file" | "dir"
  path: string
  children?: FileTreeNode[]
}

interface FileChange {
  path: string
  action: "create" | "update" | "delete"
  content: string | null
  reason: string
}

interface IssuesFound {
  codeQuality: string[]
  security: string[]
  redundancy: string[]
  formatting: string[]
}

interface SuggestionsState {
  status: "idle" | "loading" | "complete" | "error"
  data: {
    prTitle: string
    prBody: string
    fileChanges: FileChange[]
    summary: string
    issuesFound: IssuesFound
  } | null
  error: string | null
}

export default function RepoPage() {
  const params = useParams()
  const slug = params.slug as string[]
  const owner = slug?.[0] || ""
  const name = slug?.[1] || ""
  const repoPath = `${owner}/${name}`

  const [state, setState] = useState<AnalysisState>({
    status: "idle",
    analysis: "",
    error: null,
  })

  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [diagram, setDiagram] = useState("")
  const [loadingDiagram, setLoadingDiagram] = useState(false)
  const [diagramType, setDiagramType] = useState<"architecture" | "flowchart" | "dependency">("architecture")

  const [activeTab, setActiveTab] = useState<"overview" | "suggestions" | "ask">("overview")
  const [question, setQuestion] = useState("")
  const [isAskingQuestion, setIsAskingQuestion] = useState(false)
  const [questionAnswer, setQuestionAnswer] = useState("")
  
  const [suggestions, setSuggestions] = useState<SuggestionsState>({
    status: "idle",
    data: null,
    error: null,
  })
  const [expandedFileChange, setExpandedFileChange] = useState<number | null>(null)

  const fetchAnalysis = useCallback(async () => {
    if (!owner || !name) return

    setState({ status: "loading", analysis: "", error: null })

    try {
      // Stream the analysis
      setState((prev) => ({ ...prev, status: "streaming" }))
      
      const analysisRes = await fetch("/api/deepwiki/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name }),
      })

      if (!analysisRes.ok) {
        throw new Error("Failed to analyze repository")
      }

      const reader = analysisRes.body?.getReader()
      if (!reader) throw new Error("No response body")

      const decoder = new TextDecoder()
      let fullText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        setState((prev) => ({ ...prev, analysis: fullText }))
      }

      setState((prev) => ({ ...prev, status: "complete" }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "An error occurred",
      }))
    }
  }, [owner, name])

  const fetchFileStructure = useCallback(async () => {
    if (!owner || !name) return

    setLoadingFiles(true)

    try {
      const res = await fetch("/api/github/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name }),
      })

      if (!res.ok) throw new Error("Failed to fetch file structure")

      const data = await res.json()
      setFileTree(data.fileTree || [])
    } catch (error) {
      console.error("Error fetching file structure:", error)
    } finally {
      setLoadingFiles(false)
    }
  }, [owner, name])

  const fetchDiagram = useCallback(async (type: "architecture" | "flowchart" | "dependency" = diagramType) => {
    if (!owner || !name) return

    setLoadingDiagram(true)

    try {
      const res = await fetch("/api/github/generate-diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name, diagramType: type }),
      })

      if (!res.ok) throw new Error("Failed to generate diagram")

      const data = await res.json()
      setDiagram(data.diagram || "")
      setDiagramType(type)
    } catch (error) {
      console.error("Error fetching diagram:", error)
    } finally {
      setLoadingDiagram(false)
    }
  }, [owner, name, diagramType])

  const fetchSuggestions = useCallback(async () => {
    if (!owner || !name) return
    if (suggestions.status === "loading") return

    setSuggestions({ status: "loading", data: null, error: null })

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo: name, autoCreatePr: false }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to fetch suggestions")
      }

      const data = await res.json()
      
      if (data.success && data.analysis) {
        setSuggestions({
          status: "complete",
          data: data.analysis,
          error: null,
        })
      } else {
        throw new Error("Invalid response format")
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error)
      setSuggestions({
        status: "error",
        data: null,
        error: error instanceof Error ? error.message : "Failed to fetch suggestions",
      })
    }
  }, [owner, name, suggestions.status])

  useEffect(() => {
    fetchAnalysis()
    fetchFileStructure()
  }, [fetchAnalysis, fetchFileStructure])
  
  // Separate effect for diagram to avoid infinite loop
  useEffect(() => {
    if (owner && name && !diagram && !loadingDiagram) {
      fetchDiagram("architecture")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, name])

  // Fetch suggestions when tab is switched to suggestions and data not loaded
  useEffect(() => {
    if (activeTab === "suggestions" && suggestions.status === "idle") {
      fetchSuggestions()
    }
  }, [activeTab, suggestions.status, fetchSuggestions])

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || isAskingQuestion) return

    setIsAskingQuestion(true)
    setQuestionAnswer("")

    try {
      const res = await fetch("/api/deepwiki/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name, question }),
      })

      if (!res.ok) throw new Error("Failed to get answer")

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body")

      const decoder = new TextDecoder()
      let fullText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        setQuestionAnswer(fullText)
      }
    } catch (error) {
      setQuestionAnswer("Sorry, I couldn't answer that question. Please try again.")
    } finally {
      setIsAskingQuestion(false)
    }
  }

  if (!owner || !name) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Invalid repository path</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <Image 
              src="/cs.svg" 
              alt="CodeSense Logo" 
              width={32} 
              height={32}
              className="rounded-lg"
            />
            <span className="font-semibold text-foreground">CodeSense</span>
          </Link>
          
          <div className="flex-1 max-w-md mx-auto">
            <RepoSearchBar size="default" />
          </div>
          
          <a
            href={`https://github.com/${repoPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View on GitHub
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Repo Info */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <span>{owner}</span>
                <span>/</span>
              </div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{name}</h1>
              <p className="text-muted-foreground">
                AI-powered analysis and documentation
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAnalysis}
              disabled={state.status === "loading" || state.status === "streaming"}
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", (state.status === "loading" || state.status === "streaming") && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="container mx-auto px-4">
          <nav className="flex gap-1 overflow-x-auto">
            {[
              { id: "overview", label: "Overview", icon: BookOpen },
              { id: "suggestions", label: "Suggestions", icon: Lightbulb },
              { id: "ask", label: "Ask", icon: MessageSquare },
            ].map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => setActiveTab(id as typeof activeTab)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
                  activeTab === id
                    ? "text-foreground border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="container mx-auto px-4 py-8">
        {state.status === "error" && (
          <div className="max-w-3xl mx-auto">
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-6 text-center">
              <p className="text-destructive mb-4">{state.error}</p>
              <Button onClick={fetchAnalysis} variant="outline">
                Try Again
              </Button>
            </div>
          </div>
        )}

        {(state.status === "loading" || (state.status === "streaming" && !state.analysis)) && (
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {state.status === "loading" ? "Fetching repository information..." : "Generating analysis..."}
              </p>
            </div>
          </div>
        )}

        {activeTab === "overview" && (state.status === "streaming" || state.status === "complete") && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Analysis Card */}
            <div className="prose prose-invert max-w-none">
              <div className="rounded-xl border border-border bg-card p-6 md:p-8">
                <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  Repository Analysis
                </h2>
                <div className="text-foreground leading-relaxed whitespace-pre-wrap">
                  {state.analysis || "Analyzing..."}
                  {state.status === "streaming" && (
                    <span className="inline-block w-2 h-5 bg-primary ml-1 animate-pulse" />
                  )}
                </div>
              </div>
            </div>

            {/* Two Column Layout for Structure and Diagram */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* File Structure */}
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <FolderTree className="w-5 h-5" />
                  Repository Structure
                </h2>
                {loadingFiles ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : fileTree.length > 0 ? (
                  <div className="max-h-[400px] overflow-y-auto">
                    <FileStructure tree={fileTree} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No files found</p>
                )}
              </div>

              {/* Architecture Diagram */}
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <GitBranch className="w-5 h-5" />
                    Architecture
                  </h2>
                  <div className="flex gap-1">
                    {(["architecture", "flowchart", "dependency"] as const).map((type) => (
                      <Button
                        key={type}
                        variant={diagramType === type ? "default" : "ghost"}
                        size="sm"
                        onClick={() => fetchDiagram(type)}
                        disabled={loadingDiagram}
                        className="text-xs px-2 py-1 h-7"
                      >
                        {type === "architecture" ? "Arch" : type === "flowchart" ? "Flow" : "Deps"}
                      </Button>
                    ))}
                  </div>
                </div>
                {loadingDiagram ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : diagram ? (
                  <div className="max-h-[400px] overflow-auto">
                    <MermaidDiagram diagramCode={diagram} title="" />
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4 text-sm">No diagram generated yet</p>
                    <Button onClick={() => fetchDiagram()} variant="outline" size="sm">
                      Generate Diagram
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "suggestions" && (
          <div className="max-w-4xl mx-auto space-y-6">
            {suggestions.status === "loading" && (
              <div className="rounded-xl border border-border bg-card p-8">
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
                  <p className="text-muted-foreground text-center">
                    Analyzing repository with DeepWiki and Gemini AI...
                  </p>
                  <p className="text-sm text-muted-foreground/60 mt-2">
                    This may take a minute for larger repositories
                  </p>
                </div>
              </div>
            )}

            {suggestions.status === "error" && (
              <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-destructive mb-1">Analysis Failed</h3>
                    <p className="text-sm text-destructive/80 mb-4">{suggestions.error}</p>
                    <Button onClick={fetchSuggestions} variant="outline" size="sm">
                      Try Again
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {suggestions.status === "complete" && suggestions.data && (
              <>
                {/* Summary Card */}
                <div className="rounded-xl border border-border bg-card p-6">
                  <div className="flex items-start gap-3 mb-4">
                    <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        {suggestions.data.prTitle}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        {suggestions.data.summary}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={fetchSuggestions}
                    variant="outline"
                    size="sm"
                    className="mt-2"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Re-analyze
                  </Button>
                </div>

                {/* Issues Found Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Code Quality */}
                  {suggestions.data.issuesFound.codeQuality.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Code2 className="w-4 h-4 text-blue-400" />
                        <h3 className="font-medium text-foreground">Code Quality</h3>
                        <span className="ml-auto text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                          {suggestions.data.issuesFound.codeQuality.length}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {suggestions.data.issuesFound.codeQuality.slice(0, 5).map((issue, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-blue-400 mt-1">-</span>
                            {issue}
                          </li>
                        ))}
                        {suggestions.data.issuesFound.codeQuality.length > 5 && (
                          <li className="text-xs text-muted-foreground/60">
                            +{suggestions.data.issuesFound.codeQuality.length - 5} more issues
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Security */}
                  {suggestions.data.issuesFound.security.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="w-4 h-4 text-red-400" />
                        <h3 className="font-medium text-foreground">Security</h3>
                        <span className="ml-auto text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                          {suggestions.data.issuesFound.security.length}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {suggestions.data.issuesFound.security.slice(0, 5).map((issue, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-red-400 mt-1">-</span>
                            {issue}
                          </li>
                        ))}
                        {suggestions.data.issuesFound.security.length > 5 && (
                          <li className="text-xs text-muted-foreground/60">
                            +{suggestions.data.issuesFound.security.length - 5} more issues
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Redundancy */}
                  {suggestions.data.issuesFound.redundancy.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <FolderTree className="w-4 h-4 text-yellow-400" />
                        <h3 className="font-medium text-foreground">Redundancy</h3>
                        <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                          {suggestions.data.issuesFound.redundancy.length}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {suggestions.data.issuesFound.redundancy.slice(0, 5).map((issue, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-yellow-400 mt-1">-</span>
                            {issue}
                          </li>
                        ))}
                        {suggestions.data.issuesFound.redundancy.length > 5 && (
                          <li className="text-xs text-muted-foreground/60">
                            +{suggestions.data.issuesFound.redundancy.length - 5} more issues
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Formatting */}
                  {suggestions.data.issuesFound.formatting.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <FileCode className="w-4 h-4 text-purple-400" />
                        <h3 className="font-medium text-foreground">Formatting</h3>
                        <span className="ml-auto text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                          {suggestions.data.issuesFound.formatting.length}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {suggestions.data.issuesFound.formatting.slice(0, 5).map((issue, idx) => (
                          <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-purple-400 mt-1">-</span>
                            {issue}
                          </li>
                        ))}
                        {suggestions.data.issuesFound.formatting.length > 5 && (
                          <li className="text-xs text-muted-foreground/60">
                            +{suggestions.data.issuesFound.formatting.length - 5} more issues
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>

                {/* File Changes */}
                {suggestions.data.fileChanges.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                      <FileCode className="w-5 h-5" />
                      Suggested File Changes
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full ml-2">
                        {suggestions.data.fileChanges.length} files
                      </span>
                    </h3>
                    <div className="space-y-3">
                      {suggestions.data.fileChanges.map((change, idx) => (
                        <div
                          key={idx}
                          className="border border-border rounded-lg overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => setExpandedFileChange(expandedFileChange === idx ? null : idx)}
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={cn(
                                  "text-xs font-medium px-2 py-0.5 rounded",
                                  change.action === "create" && "bg-green-500/20 text-green-400",
                                  change.action === "update" && "bg-blue-500/20 text-blue-400",
                                  change.action === "delete" && "bg-red-500/20 text-red-400"
                                )}
                              >
                                {change.action}
                              </span>
                              <code className="text-sm text-foreground">{change.path}</code>
                            </div>
                            <span className="text-muted-foreground text-sm">
                              {expandedFileChange === idx ? "Hide" : "Show"}
                            </span>
                          </button>
                          {expandedFileChange === idx && (
                            <div className="border-t border-border p-4 bg-muted/30">
                              <p className="text-sm text-muted-foreground mb-3">
                                {change.reason}
                              </p>
                              {change.content && (
                                <pre className="text-xs bg-background p-3 rounded-lg overflow-x-auto border border-border">
                                  <code>{change.content}</code>
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* PR Body Preview */}
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                    <GitBranch className="w-5 h-5" />
                    Pull Request Description
                  </h3>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {suggestions.data.prBody}
                    </div>
                  </div>
                </div>
              </>
            )}

            {suggestions.status === "idle" && (
              <div className="rounded-xl border border-border bg-card p-8">
                <div className="flex flex-col items-center justify-center py-8">
                  <Lightbulb className="w-12 h-12 text-muted-foreground/40 mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    Get AI-Powered Suggestions
                  </h3>
                  <p className="text-sm text-muted-foreground text-center mb-6 max-w-md">
                    Analyze this repository for code quality issues, security vulnerabilities, 
                    redundancy, and formatting problems using DeepWiki and Gemini AI.
                  </p>
                  <Button onClick={fetchSuggestions}>
                    <Lightbulb className="w-4 h-4 mr-2" />
                    Generate Suggestions
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "ask" && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="rounded-xl border border-border bg-card p-6 md:p-8">
              <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Ask about this repository
              </h2>
              <form onSubmit={handleAskQuestion} className="space-y-4">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask anything about this repository... (e.g., 'What authentication methods are supported?' or 'How does the routing work?')"
                  className="w-full h-32 p-4 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-muted-foreground"
                />
                <Button type="submit" disabled={!question.trim() || isAskingQuestion}>
                  {isAskingQuestion ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Thinking...
                    </>
                  ) : (
                    "Ask Question"
                  )}
                </Button>
              </form>
            </div>

            {questionAnswer && (
              <div className="rounded-xl border border-border bg-card p-6 md:p-8">
                <h3 className="text-lg font-semibold text-foreground mb-4">Answer</h3>
                <div className="text-foreground leading-relaxed whitespace-pre-wrap">
                  {questionAnswer}
                  {isAskingQuestion && (
                    <span className="inline-block w-2 h-5 bg-primary ml-1 animate-pulse" />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
