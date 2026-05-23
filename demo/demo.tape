# JobForge Demo — AI Job Search Pipeline
# Record with: cd demo && vhs demo.tape

Output demo.gif
Output demo.webm

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms
Set PlaybackSpeed 0.5

# Title card
Type "# JobForge — AI-Powered Job Search Pipeline"
Enter
Sleep 1.5s

Type "# Paste a job URL. Get a full evaluation, tailored CV, and tracker entry."
Enter
Sleep 1.5s

Type "clear"
Enter
Sleep 500ms

# Show the command menu
Type "claude '/job-forge'"
Sleep 1s
Enter
Sleep 500ms

# Simulate the menu output
Type@0ms "job-forge -- Command Center"
Enter
Type@0ms ""
Enter
Type@0ms "Available commands:"
Enter
Type@0ms "  /job-forge {JD}      -> AUTO-PIPELINE: evaluate + report + PDF + tracker"
Enter
Type@0ms "  /job-forge offer     -> Evaluation only A-F (no auto PDF)"
Enter
Type@0ms "  /job-forge compare   -> Compare and rank multiple offers"
Enter
Type@0ms "  /job-forge contact   -> LinkedIn outreach using your evaluation"
Enter
Type@0ms "  /job-forge deep      -> Deep company research"
Enter
Type@0ms "  /job-forge pdf       -> ATS-optimized CV generation"
Enter
Type@0ms "  /job-forge scan      -> Scan 45+ company portals"
Enter
Type@0ms "  /job-forge batch     -> Parallel batch evaluation"
Enter
Type@0ms "  /job-forge tracker   -> Application status dashboard"
Enter
Type@0ms "  /job-forge followup  -> Timing-based follow-up nudges"
Enter
Type@0ms "  /job-forge rejection -> Rejection pattern analysis"
Enter
Type@0ms "  /job-forge negotiation -> Offer negotiation strategy"
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

# Demo: paste a URL
Type "# Step 1: Paste a job URL — full pipeline runs automatically"
Enter
Sleep 1s

Type "claude 'https://jobs.lever.co/anthropic/ai-engineer'"
Sleep 500ms
Enter
Sleep 1s

# Simulate evaluation output
Type@0ms ""
Enter
Type@0ms ">> Archetype detected: AI Platform / LLMOps Engineer"
Enter
Type@0ms ">> Scoring across 10 weighted dimensions..."
Enter
Sleep 1s
Type@0ms ""
Enter
Type@0ms "  | Dimension              | Weight | Score |"
Enter
Type@0ms "  |------------------------|--------|-------|"
Enter
Type@0ms "  | North Star alignment   |   25%  |  4.5  |"
Enter
Type@0ms "  | CV match               |   15%  |  4.0  |"
Enter
Type@0ms "  | Seniority fit          |   15%  |  4.0  |"
Enter
Type@0ms "  | Comp estimate          |   10%  |  4.5  |"
Enter
Type@0ms "  | Growth trajectory      |   10%  |  5.0  |"
Enter
Type@0ms "  | Remote quality         |    5%  |  3.5  |"
Enter
Type@0ms "  | Company reputation     |    5%  |  5.0  |"
Enter
Type@0ms "  | Tech stack modernity   |    5%  |  5.0  |"
Enter
Type@0ms "  | Speed to offer         |    5%  |  3.0  |"
Enter
Type@0ms "  | Cultural signals       |    5%  |  4.0  |"
Enter
Type@0ms "  |------------------------|--------|-------|"
Enter
Type@0ms "  | WEIGHTED TOTAL         |        |  4.3  |"
Enter
Sleep 2s

Type@0ms ""
Enter
Type@0ms ">> Report saved: reports/047-anthropic-2026-04-05.md"
Enter
Type@0ms ">> PDF generated: output/cv-anthropic-2026-04-05.pdf"
Enter
Type@0ms ">> Tracker updated: #47 | Anthropic | AI Engineer | 4.3/5 | Evaluated"
Enter
Sleep 2s

Type "clear"
Enter
Sleep 500ms

# Demo: batch processing
Type "# Step 2: Batch evaluate 10+ offers in parallel"
Enter
Sleep 1s

Type "claude '/job-forge batch'"
Sleep 500ms
Enter
Sleep 1s

Type@0ms ""
Enter
Type@0ms "=== job-forge batch runner ==="
Enter
Type@0ms "Parallel: 3 | Input: 12 offers"
Enter
Type@0ms ""
Enter
Type@0ms "  [1/12] Anthropic — AI Engineer ........... 4.3/5"
Enter
Sleep 300ms
Type@0ms "  [2/12] Datadog — Staff ML Engineer ....... 3.8/5"
Enter
Sleep 300ms
Type@0ms "  [3/12] Stripe — AI Platform Lead ......... 4.6/5"
Enter
Sleep 300ms
Type@0ms "  [4/12] Notion — Applied AI Engineer ...... 4.1/5"
Enter
Sleep 300ms
Type@0ms "  [5/12] Vercel — AI Product Manager ....... 3.2/5"
Enter
Sleep 300ms
Type@0ms "  [6/12] Linear — Senior AI Engineer ....... 4.4/5"
Enter
Sleep 300ms
Type@0ms "  ..."
Enter
Sleep 1s
Type@0ms ""
Enter
Type@0ms "  12 evaluated | 12 reports | 12 PDFs | avg score: 4.0/5"
Enter
Sleep 2s

Type "clear"
Enter
Sleep 500ms

# Demo: LinkedIn outreach
Type "# Step 3: AI-crafted LinkedIn outreach from your evaluation"
Enter
Sleep 1s

Type "claude '/job-forge contact Stripe'"
Sleep 500ms
Enter
Sleep 1s

Type@0ms ""
Enter
Type@0ms ">> Loading evaluation report #049-stripe-2026-04-05.md"
Enter
Type@0ms ">> Top proof points from Block B:"
Enter
Type@0ms "   1. Built production RAG pipeline serving 50k queries/day"
Enter
Type@0ms "   2. Led AI platform migration reducing inference costs 40%"
Enter
Type@0ms ""
Enter
Type@0ms ">> Target: Jane Smith, Engineering Manager — AI Platform"
Enter
Type@0ms ""
Enter
Type@0ms ">> Message (289 chars):"
Enter
Type@0ms '   "Your AI Platform team'"'"'s work on fraud detection is'
Enter
Type@0ms '   impressive. I built a RAG pipeline handling 50k daily'
Enter
Type@0ms '   queries with 40% cost reduction — would love to chat'
Enter
Type@0ms '   about how that maps to your infra challenges. 15 min?"'
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

# Closing
Type "# JobForge: Evaluate. Apply. Land."
Enter
Sleep 1s
Type "# github.com/Agent-Pattern-Labs/JobForge"
Enter
Sleep 3s
