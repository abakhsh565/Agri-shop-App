# Repository Scaffold — Before Real Development Starts

This is the one item on your checklist that's an action, not just a document. Do this first, then hand the repo to Claude Code/Codex with `AI_START_PROMPT.md`.

## Step 1 — Create the GitHub Repository
1. Create a **private** GitHub repository (e.g. `agri-shop-management`).
2. Clone it locally, or open it directly in your chosen browser-based editor (Google Cloud Shell Editor, Codespaces, etc. — see `docs/TECH_STACK.md`).

## Step 2 — Add This Entire Package First
Copy everything from this package (`00_PROJECT_BRIEF.md`, `AGENTS.md`, `AI_START_PROMPT.md`, `README.md`, `docs/`) into the repo root, unchanged. This becomes the permanent project memory (ADR-003) — commit it before any app code exists.

```
git add .
git commit -m "docs: initial project brief, PRD, architecture, and AI agent rules"
git push
```

## Step 3 — Expected Folder Structure Once Code Exists
```
/
├── 00_PROJECT_BRIEF.md
├── AGENTS.md
├── AI_START_PROMPT.md
├── README.md
├── docs/                      (everything from this package)
├── app/                       (Expo/React Native source)
│   ├── core/                  (Supabase client, auth context, shared types)
│   ├── auth/
│   ├── dashboard/
│   ├── sales/
│   ├── customers/
│   ├── products/
│   ├── inventory/
│   ├── suppliers/
│   ├── purchases/
│   ├── employees/
│   ├── payments/
│   ├── reports/
│   └── settings/
├── supabase/
│   ├── migrations/            (tracked schema changes, never manual dashboard edits)
│   └── functions/             (RPC/Edge Functions, organized by domain — see D6)
│       ├── auth/
│       ├── inventory/
│       ├── sales/
│       └── suppliers/
├── app.json / eas.json        (Expo config)
├── package.json
└── .gitignore                 (must exclude .env, any local secrets)
```

## Step 4 — First Real Commands (for the AI agent to run once it starts)
```
npx create-expo-app app --template
npx supabase init
```
Followed by connecting to the two Supabase projects (dev/production) per `docs/TECH_STACK.md` — actual project URLs/keys go in environment variables, never committed.

## Step 5 — .gitignore Baseline
```
node_modules/
.env
.env.local
*.apk
.expo/
```

## Step 6 — Then, and Only Then
Hand the repo to Claude Code/Codex with the contents of `AI_START_PROMPT.md` as the first message. It will read the docs, produce an `ARCHITECTURE_REVIEW.md`, and — once D18 (SMS provider choice) is resolved — begin Phase 1.
