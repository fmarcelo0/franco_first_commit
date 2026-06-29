# Files Not Tracked in Git

These files and folders are listed in `.gitignore`, which means git deliberately
**does not** track or upload them to GitHub. They're either secrets, machine-
generated, or local-only. This doc explains what each one is and why it's ignored.

| Pattern | What it is | Why it's ignored |
|---------|------------|------------------|
| `node_modules/` | The installed npm dependencies (thousands of files). | Huge and reproducible — anyone can recreate it with `npm install` from `package.json`. |
| `dist/` | The compiled JavaScript output from `tsc` (the TypeScript build). | Generated from the `.ts` source by `npm run build`; never edited by hand. |
| `.env` | The real environment file holding **secret keys** (Anthropic, Twilio, Deepgram, Booker). | Contains credentials. Committing it would leak our API keys publicly. Use `.env.example` as the safe template instead. |
| `.env.*` | Any other env variants (e.g. `.env.local`, `.env.production`). | Same reason as `.env` — they hold secrets and machine-specific settings. |
| `.DS_Store` | A macOS Finder metadata file created automatically in folders. | Junk file specific to Mac; irrelevant to the project and noisy in commits. |
| `npm-debug.log*` | Crash/debug logs npm writes when something goes wrong. | Temporary local logs; not part of the codebase. |
| `transcripts/` | Saved demo conversation transcripts (`adore-demo-*.txt`). | Generated each time the demo runs; local artifacts that may contain customer names. Share them deliberately. |

## Notes
- "Ignored" only means *not stored in git* — these files still exist and work
  normally on your machine.
- The one you must never lose locally is **`.env`** (your secret keys). Because
  it's not in git, keep a safe backup. The structure of what it should contain
  is documented in **`.env.example`** (which *is* tracked).
- ⚠️ The pattern `.env.*` also matches `.env.example`. If you want that template
  committed to GitHub, add a negation line `!.env.example` to `.gitignore`.
- To see everything git is currently ignoring in the repo, run:
  `git status --ignored`
