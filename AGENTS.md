# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

## Git workflow

Every change made in this repo must land in git — never leave work only in the
working tree.

- After finishing a task (feature, fix, or refactor), stage the related files and
  commit them. Don't batch unrelated work into one commit.
- Use Conventional Commits, matching the existing history:
  `feat(driver): scheduled view`, `fix: ...`, `chore: ...`, `refactor: ...`.
- Push to `origin main` once the work is committed and the build/tests pass.
- Never commit `.env` or other secrets; check `.gitignore` covers new build or
  tooling output before staging.
