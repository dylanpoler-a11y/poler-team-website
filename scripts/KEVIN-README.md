# Poler Team Website — Kevin's Setup Guide

Hey Kev! Here's how to get set up to collaborate on the website (homesinsoflorida.com). Should take about 5 minutes.

---

## Step 1: Accept the GitHub Invite

You should have an email from GitHub inviting you to `dylanpoler-a11y/poler-team-website`. Click **Accept invitation**.

Or go directly to: https://github.com/dylanpoler-a11y/poler-team-website/invitations

---

## Step 2: Clone the Repo

Open Terminal and run:

```bash
cd ~/Documents
git clone https://github.com/dylanpoler-a11y/poler-team-website.git
cd poler-team-website
```

If git asks for credentials, you'll need to authenticate with GitHub. Easiest way:

```bash
brew install gh
gh auth login
```

Then clone again.

---

## Step 3: Run the Setup Script

This sets up auto-sync so your changes automatically push and you automatically get my changes:

```bash
bash scripts/kevin-setup.sh
```

That's it. You'll see a confirmation message. From now on:
- Every 2 minutes, any file you save gets auto-committed and pushed
- Every 2 minutes, any changes I push get auto-pulled to your machine
- You'll get macOS notifications when syncs happen

---

## Step 4: Get the Hero Video

The main hero video (`sunny-isles-drone.mp4`, 585MB) is too big for GitHub. I'll AirDrop it to you — just drop it in the repo folder:

```
~/Documents/poler-team-website/sunny-isles-drone.mp4
```

---

## How to Edit the Website

The website is plain HTML/CSS/JS — no build tools needed. Just open the files and edit:

| File | What it controls |
|------|-----------------|
| `index.html` | All page content and structure |
| `styles.css` | All styling (colors, layout, animations) |
| `script.js` | Interactions, language switcher, chatbot |

To preview locally, just open `index.html` in your browser. Or if you have VS Code:

```bash
code ~/Documents/poler-team-website
```

Then right-click `index.html` → "Open with Live Server" (if you have the extension).

---

## Using Claude Code (Optional but Recommended)

The repo has a `CLAUDE.md` file that gives Claude full context about the project. To use it:

1. Install Claude Code: https://claude.ai/claude-code
2. Open Terminal in the repo folder:
   ```bash
   cd ~/Documents/poler-team-website
   claude
   ```
3. Ask Claude anything — it already knows the file structure, design system, and conventions.

Example prompts:
- "Change the hero subtitle text to something about luxury condos"
- "Add a new team member card for Noel"
- "Update the Spanish translations for the contact section"

---

## Quick Reference

| Action | Command |
|--------|---------|
| Check sync status | `launchctl list \| grep polerteam` |
| View sync logs | `tail -f /tmp/polerteam-autosync.log` |
| Stop auto-sync | `launchctl unload ~/Library/LaunchAgents/com.polerteam.autosync.plist` |
| Restart auto-sync | `launchctl unload ~/Library/LaunchAgents/com.polerteam.autosync.plist && launchctl load ~/Library/LaunchAgents/com.polerteam.autosync.plist` |
| Manual push | `cd ~/Documents/poler-team-website && git add -A && git commit -m "your message" && git push` |

---

## What NOT to Touch

- Don't rename or delete `CLAUDE.md` — that's the AI context file
- Don't commit the big video files manually — they're gitignored on purpose
- Don't change `.gitignore` or `.vercelignore` without checking with me

---

Any questions, just text me. 🤙
