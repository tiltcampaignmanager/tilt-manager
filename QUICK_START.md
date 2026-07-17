# Quick Start: Import Your Google Sheets

## TL;DR

1. **Export all sheet tabs as CSV** from Google Sheets
2. **Name each file exactly as the sheet tab** (e.g., `Apr '26 Videos - [TCG] CardHalo.csv`)
3. **Open Tilt → Automations tab**
4. **Click "Import Google Sheet Campaigns (UK)"**
5. **Select all CSV files at once**
6. **Click "Import All"**
7. ✅ Done! All campaigns and videos imported to UK

---

## How to Export from Google Sheets

### For Each Sheet Tab:

1. **Right-click the sheet tab** at the bottom
2. Click **"Download"** (or use File → Download)
3. Choose **"CSV (.csv)"** format
4. **Save with the exact sheet name**
   - Sheet tab: `Apr '26 Videos - [TCG] CardHalo`
   - File name: `Apr '26 Videos - [TCG] CardHalo.csv`

### Naming Format

✅ **Correct**: `Apr '26 Videos - [TCG] CardHalo.csv`

**Parser extracts:**
- Month: `Apr '26`
- Category: `TCG` (from brackets)
- Campaign name: `[TCG] CardHalo`

---

## Import Process (5 steps)

### 1. Open Tilt Creative Tracker
Go to the **Automations** tab

### 2. Find the Import Section
Scroll to **"Import Google Sheet Campaigns (UK)"**

### 3. Click the File Input
Or drag-and-drop multiple CSV files

### 4. Select All CSV Files
Hold **Cmd** (Mac) or **Ctrl** (Windows) and click all your CSV files

### 5. Click "Import All"
Preview shows:
- ✅ Campaign names (parsed from filenames)
- ✅ Video count per campaign
- ❌ Any errors (if rows are missing Video Name)

Success toast: `"Imported X campaigns, Y assets"`

---

## What Gets Imported

### Per Campaign
- **Campaign Name**: Extracted from filename `[Category] Name`
- **Category**: From brackets `[TCG]`, `[Sneakers]`, etc.
- **Month/Year**: `Apr '26`, `May 2026`, etc.
- **Country**: Always **UK**
- **Type**: Always **Paid Ads**

### Per Video
- **PN #** → Position number (1, 2, 3...)
- **Video Name** → Asset name
- **Editor** → Zidni, Sharm, Patty, or Elsa
- **Editing Brief** → Notion link
- **Final Video** → Final video link
- **Date Approved** → Approval date
- **Status** → "Approved" if marked in sheet

### NOT Imported (Skipped)
- Concepts
- Variations
- Raw Video File
- Ad Status

---

## Common Issues

| Issue | Solution |
|-------|----------|
| "Validation error" | Check that every row has a `Video Name` |
| Campaign name looks wrong | Check filename format: `Month Year - [Category] Name.csv` |
| Editor not assigned | Verify spelling: must be exactly `Zidni`, `Sharm`, `Patty`, or `Elsa` |
| Date not imported | Make sure `Date Approved` column exists and has dates |

---

## What Happens After Import

✅ Go to **Campaigns tab** — all campaigns now visible  
✅ Click a campaign — all videos listed with editors/dates  
✅ Editors assigned? Videos marked "Assigned"  
✅ Dates approved? Videos marked "Approved"  

### Next Steps

1. Add **ETA** (Scheduler tab or inline)
2. Add **Raw Video** links if not in Google Sheets
3. Start using **Today board** to track approvals
4. Use **Notifications** to send Slack pings

---

## Sample Files

Check these files in the repo for examples:
- `sample-google-sheet-export.csv` — What a real export looks like
- `GOOGLE_SHEETS_IMPORT_GUIDE.md` — Full detailed guide

---

**Questions?** Open Automations tab and look for the Import button + full guide!
