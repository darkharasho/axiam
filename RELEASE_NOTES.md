# Release Notes

Version v0.5.1 — March 3, 2026

## 🌟 Highlights
- Linux automation script version updated to linux-autologin-v17.

## 🛠️ Improvements
- Credential tab counting logic now starts from zero to refine how the login automation selects fields.
- Added a retry path for the email anchor verification so the login flow can retry when the first attempt doesn't verify.

## 🧯 Fixes
- More robust handling of email field verification, including cases where the field is non-copyable or empty.
- Improved tracking of email verification status during the login flow.

## ⚠️ Breaking Changes
- None.
