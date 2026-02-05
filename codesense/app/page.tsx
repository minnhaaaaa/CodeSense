import { RepoSearchBar } from "@/components/RepoSearchBar"
import { RepoCard } from "@/components/RepoCard"
import { BookOpen, Zap, Code2, Sparkles } from "lucide-react"
import { TypingAnimation } from "@/components/ui/typing-animation"
import { RainbowButton } from "@/components/ui/rainbow-button"
import { InteractiveGridPattern } from "@/components/ui/interactive-grid-pattern"
import Image from "next/image"

const FEATURED_REPOS = [
  {
    owner: "vercel",
    name: "next.js",
    description: "The React Framework for the Web. Build full-stack applications with automatic optimization.",
    stars: 128000,
    forks: 26500,
    language: "TypeScript",
    languageColor: "#3178c6",
  },
  {
    owner: "facebook",
    name: "react",
    description: "A declarative, efficient, and flexible JavaScript library for building user interfaces.",
    stars: 232000,
    forks: 47500,
    language: "JavaScript",
    languageColor: "#f7df1e",
  },
  {
    owner: "microsoft",
    name: "vscode",
    description: "Visual Studio Code - Code editing redefined. Free and built on open source.",
    stars: 168000,
    forks: 30200,
    language: "TypeScript",
    languageColor: "#3178c6",
  },
  {
    owner: "tailwindlabs",
    name: "tailwindcss",
    description: "A utility-first CSS framework for rapid UI development with modern design patterns.",
    stars: 85000,
    forks: 4300,
    language: "TypeScript",
    languageColor: "#3178c6",
  },
  {
    owner: "openai",
    name: "openai-cookbook",
    description: "Examples and guides for using the OpenAI API effectively in your applications.",
    stars: 62000,
    forks: 10200,
    language: "Jupyter Notebook",
    languageColor: "#f37626",
  },
  {
    owner: "langchain-ai",
    name: "langchain",
    description: "Building applications with LLMs through composability. Chains, agents, and memory.",
    stars: 98000,
    forks: 15800,
    language: "Python",
    languageColor: "#3572A5",
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background relative overflow-hidden">
      {/* Interactive Grid Background */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <InteractiveGridPattern 
          width={50} 
          height={50} 
          squares={[40, 40]} 
          className="opacity-40"
          squaresClassName="stroke-white/5"
        />
      </div>

      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image 
              src="/cs.svg" 
              alt="CodeSense Logo" 
              width={40} 
              height={40}
              className="rounded-xl shadow-lg shadow-cyan-500/25"
            />
            <span className="font-bold text-xl text-foreground tracking-tight">CodeSense</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Docs</a>
            <a href="#" className="hover:text-foreground transition-colors">API</a>
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-24 md:py-32 relative z-10">
        <div className="container mx-auto px-4 relative">
          <div className="max-w-3xl mx-auto text-center">
            {/* Typing Animation Title */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 text-balance min-h-[80px] md:min-h-[120px]">
              <TypingAnimation 
                text="Make your first open source contribution" 
                duration={50}
                className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent"
              />
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-12 text-pretty max-w-2xl mx-auto">
              Analyze any GitHub repository with AI-powered insights and contribution ideas.
            </p>
            
            <RepoSearchBar size="large" className="max-w-2xl mx-auto mb-8" />
            
            <p className="text-sm text-muted-foreground mb-8">
              Try or paste any <code className="px-2 py-1 bg-secondary rounded text-cyan-400">github</code> URL
            </p>

            {/* Rainbow CTA Button */}
            <RainbowButton
              onClick={() => {
                document.getElementById("explore-repos")?.scrollIntoView({ behavior: "smooth" })
              }}
            >
              <Sparkles className="w-4 h-4" />
              Explore Repositories
            </RainbowButton>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 border-t border-border bg-background/60 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="flex flex-col items-center text-center group">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <BookOpen className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Auto Documentation</h3>
              <p className="text-sm text-muted-foreground">
                AI-generated documentation that explains the architecture and key concepts.
              </p>
            </div>
            <div className="flex flex-col items-center text-center group">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <Zap className="w-6 h-6 text-yellow-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Instant PR Suggestion</h3>
              <p className="text-sm text-muted-foreground">
                Get comprehensive insights about any issues or potential improvements to be made
              </p>
            </div>
            <div className="flex flex-col items-center text-center group">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <Code2 className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Smart Q&A</h3>
              <p className="text-sm text-muted-foreground">
                Ask questions about the codebase and get context aware answers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Repos */}
      <section id="explore-repos" className="py-16 border-t border-border relative z-10 scroll-mt-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Explore popular repositories
            </h2>
            <p className="text-muted-foreground">
              Start exploring with these popular open-source projects
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
            {FEATURED_REPOS.map((repo) => (
              <RepoCard key={`${repo.owner}/${repo.name}`} {...repo} />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border bg-background/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Powered by DeepWiki MCP • Built with ❤️</p>
        </div>
      </footer>
    </main>
  )
}
