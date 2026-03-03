# Poler Team Website — Kevin's Setup Guide

Hey Kev! Here's how to get set up to collaborate on the website (homesinsoflorida.com). Follow these steps in order — should take about 10 minutes total.

---

## Step 0: Install the Basics (One-Time Setup)

Open **Terminal** (press `Cmd + Space`, type "Terminal", hit Enter) and run these one at a time:

### Install Homebrew (Mac package manager)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
It'll ask for your Mac password (the one you use to log in). Type it — nothing will appear as you type, that's normal. Press Enter.

If it says "Add Homebrew to your PATH" at the end, run whatever commands it tells you (usually something like):
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### Install Git & GitHub CLI
```bash
brew install git gh
```

### Log into GitHub
```bash
gh auth login
```
Choose:
- **GitHub.com**
- **HTTPS**
- **Yes** (authenticate with GitHub credentials)
- **Login with a web browser**

It'll give you a code and open your browser. Paste the code, authorize, done.

---

## Step 1: Accept the GitHub Collaborator Invite

Check your email for an invite from GitHub to `dylanpoler-a11y/poler-team-website`.

Click **Accept invitation** in the email.

Or go directly to: https://github.com/dylanpoler-a11y/poler-team-website/invitations

---

## Step 2: Clone the Website to Your Computer

```bash
cd ~/Documents
gh repo clone dylanpoler-a11y/poler-team-website
cd poler-team-website
```

This downloads the entire website to `~/Documents/poler-team-website/` on your Mac.

---

## Step 3: Run the Auto-Sync Setup

This is the magic — one command sets up automatic syncing between our computers:

```bash
bash scripts/kevin-setup.sh
```

You should see:
```
🏠 Setting up Poler Team Website auto-sync...
📂 Repo path: /Users/kevin/Documents/poler-team-website
🔧 Git found at: /opt/homebrew/bin/git
✅ Auto-sync is now active!
```

**What this does:**
- Every 2 minutes, any file you save gets automatically committed and pushed to GitHub
- Every 2 minutes, any changes Dylan pushes get automatically pulled to your machine
- You'll get macOS notification popups when syncs happen (with sound)
- Vercel auto-deploys to homesinsoflorida.com whenever changes hit GitHub

**You don't have to think about git at all after this.** Just edit files and save — everything syncs automatically.

---

## Step 4: Get the Hero Video from Dylan

The main drone video (`sunny-isles-drone.mp4`, 585MB) is too big for GitHub, so I'll AirDrop it to you.

Once you get it, move it into the website folder:
```
~/Documents/poler-team-website/sunny-isles-drone.mp4
```

You can also just drag it into the folder in Finder.

---

## How to Edit the Website

The site is just 3 files — no fancy tools needed:

| File | What it controls |
|------|-----------------|
| `index.html` | All the page content (text, sections, images) |
| `styles.css` | How everything looks (colors, layout, fonts, animations) |
| `script.js` | Interactive behavior (language switcher, chatbot, animations) |

### To preview your changes:
1. Open Finder → go to `~/Documents/poler-team-website/`
2. Double-click `index.html` — it opens in your browser
3. After editing a file and saving, refresh the browser to see changes

### Recommended: Install VS Code
Download from https://code.visualstudio.com/ then:
```bash
code ~/Documents/poler-team-website
```
This opens the whole project. Edit files on the left, save with `Cmd + S`.

Install the **"Live Server"** extension in VS Code — then right-click `index.html` → "Open with Live Server" for auto-refreshing previews.

---

## Using Claude Code (Recommended — Makes Everything Easier)

The repo has a `CLAUDE.md` file that gives Claude full context about the entire project. This means you can just tell Claude what you want in plain English and it'll edit the code for you.

### Install Claude Code
```bash
npm install -g @anthropic-ai/claude-code
```
(If `npm` isn't found, run `brew install node` first)

### Use it
```bash
cd ~/Documents/poler-team-website
claude
```

Then just talk to it. Examples:
- "Change the hero subtitle to 'Your Gateway to South Florida Luxury'"
- "Add a new team member card for Noel with role 'Hospitality Consultant'"
- "Make the contact form button gold instead of navy"
- "Update all the Spanish translations for the expertise section"
- "Add a new Instagram post image — I put it in ig-post-9.jpg"

Claude already knows all the colors, fonts, file structure, and conventions. It'll edit the files directly and auto-sync handles the rest.

---

## Quick Reference

| What you want to do | Command |
|---------------------|---------|
| Check if sync is running | `launchctl list \| grep polerteam` |
| View sync logs | `tail -f /tmp/polerteam-autosync.log` |
| Pause auto-sync | `launchctl unload ~/Library/LaunchAgents/com.polerteam.autosync.plist` |
| Resume auto-sync | `launchctl load ~/Library/LaunchAgents/com.polerteam.autosync.plist` |
| Force push now (don't wait 2 min) | `cd ~/Documents/poler-team-website && git add -u && git commit -m "update" && git push` |
| See what changed | `cd ~/Documents/poler-team-website && git log --oneline -10` |

---

## Rules

- **Don't delete or rename** `CLAUDE.md`, `.gitignore`, or `.vercelignore`
- **Don't manually add** the big video files to git — they're gitignored on purpose
- **Just save files and let auto-sync handle it** — no need to manually commit/push
- If something breaks or you get a merge conflict notification, text Dylan

---

## How It All Works (The Big Picture)

```
You edit a file → save → auto-sync commits & pushes (2 min)
                                    ↓
                              GitHub repo
                                    ↓
                         Vercel auto-deploys
                                    ↓
                          homesinsoflorida.com is updated

Dylan edits a file → his auto-sync pushes → your auto-sync pulls it down
```

Everything is automatic. Just edit, save, and the live site updates within a few minutes.

---

Questions? Text me. 🤙
