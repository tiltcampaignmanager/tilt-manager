# Google Sheets Batch Import Guide

Your Tilt Creative Tracker now supports **batch importing all your Google Sheets at once**—perfect for your multi-tab structure where each tab is a campaign.

## Your Sheet Format

Your sheets are organized as:
- **Sheet name format**: `Month Year - [Category] Name`
- **Example**: `Apr '26 Videos - [TCG] CardHalo`
- **All campaigns**: UK
- **Assets**: One row per video

### Columns Imported
✅ **PN #** → position number in campaign  
✅ **Video Name** → asset name  
✅ **Editing Brief** → Notion brief link  
✅ **Editor** → assigned editor (Zidni, Sharm, Patty, Elsa)  
✅ **Final Video** → final video link  
✅ **Date Approved** → approval date  
✅ **Status** → "Approved" detected from status field  

❌ **Skipped**: Concepts, Variations, Raw Video File, Ad Status

---

## How to Import

### Step 1: Export All Sheets as CSV

1. Open your Google Sheet: `TCG_IOP_WhichOne_CardHalo_V7` (or any campaign sheet)
2. For **each sheet tab** at the bottom:
   - Right-click the tab name → **Download** (or File → Download)
   - Save as CSV format
   - **Keep the filename exactly as the sheet name**
   - Example: save as `Apr '26 Videos - [TCG] CardHalo.csv`
3. Repeat for all campaign sheets
   - `Apr '26 Videos - [Sneakers] RS Kicks.csv`
   - `Apr '26 Videos - [Bags & Acc] Own That Bag.csv`
   - etc.

**Pro tip**: You can also do File → Download → All sheets (if Google Sheets offers it) to get a zip, then extract the CSVs.

### Step 2: Open Tilt Creative Tracker

1. Open the Tilt Creative Tracker app
2. Go to **Automations** tab
3. Scroll to **Import Google Sheet Campaigns (UK)**
4. Click the file input or drag-and-drop

### Step 3: Select Multiple CSV Files

1. **Select all CSV files at once** (hold Cmd/Ctrl and click multiple files)
2. The modal shows a preview of each campaign:
   - Campaign name (extracted from filename)
   - Number of videos found
   - Any validation errors
3. Click **Import All**

### Step 4: Verify Import

- Success toast shows: `"Imported X campaigns (Y skipped), Z assets"`
- Go to **Campaigns** tab → all campaigns now appear
- Click into any campaign → all videos are there with:
  - Editors assigned
  - ETA blank (you can add in Scheduler or inline)
  - Final video links preserved
  - Date Approved populated
  - Status set correctly

---

## What Happens During Import

### Campaign Creation
- **Name**: Extracted from filename
  - Input: `Apr '26 Videos - [TCG] CardHalo.csv`
  - Campaign name: `[TCG] CardHalo`
- **Category**: Extracted from brackets
  - Input: `[TCG]` → category: `TCG`
- **Month/Year**: Extracted from filename prefix
  - Input: `Apr '26` → monthYear: `Apr '26`
- **Country**: Always `UK`
- **Type**: Always `Paid Ads`

### Asset Creation
- **PN**: From `PN #` column (preserves your numbering)
- **Name**: From `Video Name`
- **Editor**: From `Editor` column (auto-assigns Assigned status if editor is set)
- **Status**: 
  - If `Status` contains "Appro" → set to `Approved`
  - If `Editor` is set → set to `Assigned`
  - Otherwise → `Draft`
- **ETA**: Left blank (you can add in Scheduler)
- **Links**: `editingBrief` and `finalVideo` preserved

### Duplicate Handling
- **Campaigns**: Skipped if a campaign with same name already exists in UK
- **Assets**: Skipped if an asset with same name already exists in that campaign
- **No overwrites**: Import only adds new data

---

## Example Workflow

### Before Import
```
Google Sheets has 4 tabs:
- Apr '26 Videos - [TCG] CardHalo (23 videos)
- Apr '26 Videos - [Sneakers] RS Kicks (18 videos)
- Apr '26 Videos - [Bags & Acc] Own That Bag (15 videos)
- May '26 Videos - [Luxury] Exclusives (12 videos)
Total: 68 videos
```

### Export as CSV
```
Download 4 CSV files:
- Apr '26 Videos - [TCG] CardHalo.csv
- Apr '26 Videos - [Sneakers] RS Kicks.csv
- Apr '26 Videos - [Bags & Acc] Own That Bag.csv
- May '26 Videos - [Luxury] Exclusives.csv
```

### Import
1. Open Tilt → Automations tab
2. Select all 4 CSV files
3. Click Import All
4. Success: "Imported 4 campaigns (0 skipped), 68 assets"

### Result
```
Campaigns tab now shows:
UK
  ├─ [TCG] CardHalo (23 videos) — Apr '26
  ├─ [Sneakers] RS Kicks (18 videos) — Apr '26
  ├─ [Bags & Acc] Own That Bag (15 videos) — Apr '26
  └─ [Luxury] Exclusives (12 videos) — May '26
```

---

## Troubleshooting

### "Missing Video Name" Error
The importer skips rows without a `Video Name`. Check your CSV for blank rows or missing data in that column.

### Campaign name not parsing correctly
Make sure your sheet name follows the exact format:
```
Month Year - [Category] Name
```

❌ Wrong:
- `Apr26Videos-TCGCardHalo` (missing spaces/brackets)
- `[TCG] CardHalo` (no month/year prefix)
- `Apr '26-TCG-CardHalo` (wrong separators)

✅ Correct:
- `Apr '26 Videos - [TCG] CardHalo`
- `May 2026 - [Sneakers] RS Kicks`
- `Q2 2026 - [Luxury] Spring Collection`

### Not all videos imported
Check the preview in the modal before clicking Import. Rows with missing `Video Name` are skipped. Fix them in Google Sheets and re-export.

### Some videos marked as Draft instead of Assigned
Make sure the `Editor` column has the correct editor name (Zidni, Sharm, Patty, or Elsa). Misspellings or extra spaces will be ignored.

---

## Next Steps (After Import)

1. **Add ETAs** in Scheduler tab or inline in Campaigns
2. **Assign editors** if not already done in Google Sheets
3. **Add Raw Video links** (not imported, add manually or via Google Sheets)
4. **Set QC status** if needed (defaults to Draft)
5. **Start tracking** approvals on the Today board

---

## Exporting Back to Google Sheets

To sync your app state back to Google Sheets:

1. **Automations** tab → **Export Campaigns & Assets** → Download CSV
2. Open Google Sheets
3. Create a new sheet called "Tilt Export - [Date]"
4. Import the CSV (Data → Import range)
5. Use this for reporting, backup, or re-sync with teams

The export includes all campaigns and assets with all current statuses, approvals, and dates.

---

**Ready?** Go to Automations tab and click "Import Google Sheet Campaigns (UK)" to get started!
