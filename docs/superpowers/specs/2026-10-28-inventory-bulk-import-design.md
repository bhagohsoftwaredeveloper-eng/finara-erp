# Inventory Items: Bulk Upload and Download (Design)

A client keeps their product list in Excel and needs to load it into Inventory and maintain it in bulk. Their sheet:

| PRODUCT CODE | PRODUCTS | CATEGORY | WEIGHT / PACK | PACKS / CASE | KG / CASE | PCS / PACK |
|---|---|---|---|---|---|---|
| 1000012713 | MAESTRO SHOESTRING FRIES | FRIES | 1kg | 10 packs | 10 kg | N/A |
| J000073-2 | MAESTRO HUNGARIAN SAUSAGE | SAUSAGE, H… | 1kg | 10 packs | 10 kg | 11 pcs |

The Items page gets three actions: **Download** (all active items as .xlsx), **Template** (an empty .xlsx in the same layout), and **Upload** (Check, then Import). The upload changes item records only. Stock quantities still move through IN/OUT transactions, which post to the GL.

## Data

`InventoryItem` gets three nullable columns (one migration):

| Field | Type | Meaning |
|---|---|---|
| `weightPerPackKg` | Decimal(10,3) | weight of one pack, in kg |
| `packsPerCase` | Int | packs in one case |
| `pcsPerPack` | Int | pieces in one pack |

Kg per case is never stored. Wherever it is shown, it is `weightPerPackKg × packsPerCase`, and it is blank when either is missing.

The item form gets a **Packaging** section with the three fields and a read-only Kg per case. `createItem` and `updateItem` accept the fields and reject negatives. They also reject fractions in the two count fields. In the item list, a grey line under the name shows whatever is set, e.g. "1 kg/pack · 10 packs/case · 11 pcs/pack".

## Columns

`server/utils/inventoryImport.js` defines the columns. They are used for download, template and upload alike:

| Label | Field | Other header names accepted |
|---|---|---|
| Product Code | `sku` | SKU, Item Code, Code |
| Item Name | `name` | Products, Product, Product Name, Name, Item |
| Category | `category` (by name) | Products, Product Category, Group |
| Unit | `unit` | UOM, Unit of Measure |
| Description | `description` | Desc |
| Cost Price | `costPrice` | Cost, Unit Cost |
| Selling Price | `sellingPrice` | Price, SRP, Unit Price |
| Reorder Level | `reorderLevel` | Reorder, Reorder Point |
| Location | `warehouseLocation` | Warehouse, Warehouse Location |
| Weight / Pack (kg) | `weightPerPackKg` | Weight / Pack, Weight per Pack |
| Packs / Case | `packsPerCase` | Packs per Case |
| Kg / Case | (checked only) | Kg per Case |
| Pcs / Pack | `pcsPerPack` | Pieces per Pack, Pcs per Pack |

Header matching ignores case and everything except letters and digits, so "WEIGHT / PACK" and "weightpack" are the same. Headers are taken left to right. Each one goes to the first field in table order that accepts it and is still free. So the client's sheet maps directly: PRODUCTS becomes Item Name and CATEGORY becomes Category. A sheet with two PRODUCTS columns (like the client's original) still works, because the second one falls through to Category. Headers that match nothing are ignored and listed in the check result.

## Reading the file (browser)

- **Library:** `exceljs` 4.4.0, loaded with a dynamic `import()` only when Download, Template or Upload is used.
- **Formats:**
  - **.xlsx:** the first worksheet is read.
  - **.csv:** read with the existing quote-aware parser, moved from the school setup page to `lib/csv.js` so both imports share it.
  - **.xls:** rejected with "Save the file as Excel Workbook (.xlsx) and try again."
- **Cell values** are turned into plain text:
  - rich text and hyperlinks become their text
  - formulas become their result
  - whole numbers become their digits, with no exponent and no ".0"
  - dates become YYYY-MM-DD
- **What is sent:** the whole grid (an array of row arrays) goes to the server. Up to 2,000 non-empty rows below the header are accepted.

## Import rules (server)

`POST /api/inventory/import` is open to ADMIN, MANAGER and ACCOUNTANT. The body is `{ grid, mapping?, dryRun }`.

1. **Header row:** the first row in which at least two cells match a column name. Rows above it are ignored, which allows a title row. If no row qualifies, the request fails with 400 "Couldn't find the header row. The file needs column names such as Product Code and Item Name."
2. **Mapping:** guessed as described under Columns unless the body includes `mapping` (one field key or null per header cell). The user can change it in the UI.
   - An unknown key returns 400, and so does a field used twice.
   - Item Name or Product Code must be mapped.
3. **Rows:**
   - Rows with every mapped cell blank are skipped.
   - More than 2,000 remaining rows returns 400.
   - Row numbers in messages are the spreadsheet's own row numbers.
4. **Values:** blank, "N/A", "NA", "-" and "none" mean blank.
   - **Text** is trimmed. Values longer than the column allows are errors: Product Code 50, Item Name 150, Category 100, Unit 20, Location 100.
   - **Cost Price, Selling Price, Reorder Level:** "₱", "PHP", commas and spaces are stripped. The result must be a number ≥ 0.
   - **Weight / Pack:** a number with an optional unit: kg, kgs, kilo(s), kilogram(s), g, gm(s), gram(s). Grams are divided by 1000, and no unit means kg. So "1kg" is 1, "500g" is 0.5 and "1.5" is 1.5.
   - **Packs / Case, Pcs / Pack:** a whole number with an optional word (pack(s), pk(s), pc(s), piece(s), pcs), e.g. "10 packs" is 10 and "11 pcs" is 11.
   - Anything else in a number column is an error naming the column and the value.
5. **Kg / Case:**
   - It is never saved.
   - If it is given along with both Weight / Pack and Packs / Case and differs from their product by more than 0.01, that's a warning: "Kg / Case 12 doesn't match 1 kg × 10 packs = 10 kg."
   - If it is given without both, that's a warning that it isn't saved on its own.
6. **Matching:** by Product Code against all of this business's items, active or not, ignoring case.
   - A code that appears on two or more rows is an error on each of them.
7. **Existing item:**
   - Each filled-in cell that differs from the item is a change. Blank cells never clear a value. Category is compared by name, ignoring case.
   - An item with no changes is "unchanged".
   - An inactive item is updated but stays inactive, with a warning.
8. **New item:**
   - Item Name is required.
   - A blank Product Code gets the next `SKU-xxxx`, numbered in file order after the business's highest existing one.
   - If the name matches an existing item (trimmed, ignoring case):
     - **with a blank Product Code**, it's an error: "Already on file as SKU-0003. Put that code in Product Code to update it."
     - **with a new Product Code**, it's only a warning that a second item with that name will be created.
   - Unit defaults to `pcs`. No GL accounts are set, the same as the Add Item form.
9. **Categories:** matched by trimmed name, ignoring case, among active categories. Missing ones are created with type PRODUCT. Names that differ only in case create one category, spelled as first seen.

**Check** (`dryRun: true`) returns:

```
{ header, mapping, fields: [{ key, label }], ignoredHeaders,
  summary: { create, update, unchanged, errors, warnings },
  newCategories: [name],
  rows: [{ row, action: 'create'|'update'|'unchanged'|'error', sku, name,
           changes: [{ field, from, to }], errors: [msg], warnings: [msg] }] }
```

**Import** (`dryRun: false`) builds the same plan again from the submitted grid; it never trusts an earlier check.
- **If any row has an error,** it saves nothing and returns 422 with the plan.
- **Otherwise,** one `$transaction` (timeout 60 s) creates the categories, creates the new items with `createMany`, and updates the changed items.
- **Afterwards,** it records one audit entry (action IMPORT, entity InventoryItem), e.g. "Imported inventory items: 38 created, 12 updated, 2 categories added". The response is `{ created, updated, unchanged, categoriesCreated }`.
- **SKU conflict:** if a unique-SKU conflict comes up during the write (another user saved at the same moment), it returns 409 "Items changed while importing. Check the file again."

## Download and Template

- `GET /api/inventory/export` returns `{ columns: [{ key, label }], rows }`. The rows are the active items sorted by name, with Kg / Case calculated.
- `GET /api/inventory/export?template=1` returns the same columns and one example row.
- The browser writes the file with exceljs:
  - **Sheet:** a sheet named "Items" with a bold, filled and frozen header row and fitted column widths.
  - **Product Code:** stored as text, so Excel never turns a code into a number.
  - **Prices:** numbers formatted `#,##0.00`.
- **File names:** `inventory-items-YYYY-MM-DD.xlsx` and `inventory-items-template.xlsx`.

## UI (`app/(dashboard)/inventory/items/page.jsx`)

- **Header:** Download and Upload buttons next to Print. Template is offered inside the Upload panel.
- **Upload panel:**
  1. Choose a file. The file name and row count are shown.
  2. A check runs automatically.
  3. The panel shows:
     - each header with a dropdown of fields, plus "Ignore". Changing one re-runs the check.
     - the summary counts and the categories to be created
     - a row list showing errors (red), warnings (amber) and each update's from → to changes
  4. **Import** is disabled while there are errors.
  5. After importing: a toast with the counts, and the item list reloads.

## Tests

- **`inventoryImport` unit tests** cover:
  - header normalisation and left-to-right assignment: the client's PRODUCTS + CATEGORY sheet, and a sheet with two PRODUCTS columns
  - header-row detection under a title row
  - each value parser, including "1kg", "500g", "10 packs", "11 pcs", "N/A", "₱1,250.00", negatives and junk text
  - the Kg / Case warnings
  - duplicate codes in a file
  - the blank-code name clash
  - blank cells never clearing values
  - inactive items
  - category creation
  - SKU numbering
  - the client's exact two rows end to end
- **Controller tests** cover:
  - dry run writes nothing
  - commit with errors returns 422 and writes nothing
  - commit creates and updates in one transaction
  - every query is scoped to `req.businessId`
- **`createItem` / `updateItem`** accept the packaging fields and reject negatives and fractional counts.

## Out of scope

- Stock quantities, opening balances and GL accounts in the file.
- Converting stock between cases and packs.
- Deleting or deactivating items through upload.
