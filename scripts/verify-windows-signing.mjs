#!/usr/bin/env node

const allowUnsigned = process.env.AXIAM_ALLOW_UNSIGNED_WINDOWS === '1';
const hasCscLink = Boolean(process.env.CSC_LINK && process.env.CSC_LINK.trim());
const hasPassword = Boolean(
  (process.env.CSC_KEY_PASSWORD && process.env.CSC_KEY_PASSWORD.trim()) ||
  (process.env.WIN_CSC_KEY_PASSWORD && process.env.WIN_CSC_KEY_PASSWORD.trim())
);

if (allowUnsigned) {
  console.warn(
    '[windows-signing] AXIAM_ALLOW_UNSIGNED_WINDOWS=1 set; skipping Windows signing checks. Artifacts are likely flagged by Smart App Control.'
  );
  process.exit(0);
}

if (!hasCscLink) {
  console.error('[windows-signing] Missing CSC_LINK.');
  console.error(
    '[windows-signing] Set CSC_LINK to your code-signing certificate (.p12/.pfx file path, URL, or base64) before publishing Windows artifacts.'
  );
  console.error(
    '[windows-signing] To bypass intentionally for testing only, set AXIAM_ALLOW_UNSIGNED_WINDOWS=1.'
  );
  process.exit(1);
}

if (!hasPassword) {
  console.warn(
    '[windows-signing] No CSC_KEY_PASSWORD/WIN_CSC_KEY_PASSWORD set. Continuing in case certificate is passwordless or available via cert store.'
  );
}

console.log('[windows-signing] Signing configuration check passed.');
