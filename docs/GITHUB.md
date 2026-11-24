# Publish on GitHub (Windows PowerShell)

A public repository with a README is **required** for the submission.

Repo name: `glance-g2` (public, no README added by GitHub)

## 1. Create the repo (in `C:\dev\glance-day1\glance`)
```
gh repo create Hajrajadoon/glance-g2 --public --description "Clear your inbox in 30 seconds on Even G2 smart glasses: AI-triaged Gmail, one-tap replies, voice edits. Heads Up hackathon, AI Assistants & Work track." --homepage https://hajrajadoon.github.io/glance-g2/
```
(Or create it on github.com: New repository, name `glance-g2`, Public, tick nothing else.)

## 2. Push
```
git init
git branch -M main
git add .
git status
```
`git status` must NOT list `.env` or `node_modules`. If it does, stop.
```
git commit -m "Hackathon start: Glance inbox triage for Even G2, landing page and docs"
$t = gh auth token
git push "https://Hajrajadoon:${t}@github.com/Hajrajadoon/glance-g2.git" main
```

## 3. Topics and landing page
```
gh repo edit Hajrajadoon/glance-g2 --add-topic even-g2,smart-glasses,gmail,ai-assistant,typescript,hackathon
gh api repos/Hajrajadoon/glance-g2/pages -X POST -f "source[branch]=main" -f "source[path]=/docs"
```
Page goes live in about a minute at https://hajrajadoon.github.io/glance-g2/

## 4. Updating later
```
git add .
git commit -m "Describe the change"
$t = gh auth token
git push "https://Hajrajadoon:${t}@github.com/Hajrajadoon/glance-g2.git" main
```
