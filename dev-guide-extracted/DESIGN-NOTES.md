# Design Notes — Figma Frames Observed
## Employee-Side App + Auth Screens

Source: 10 imported frames across 9 screen folders.
Status: Read-only observation. No code written yet.

---

## Critical Design Decisions (Different from Earlier Plan)

| Topic | Earlier Plan | Actual Figma Design |
|---|---|---|
| Font | Inter | **Geist** (Bold, Regular, Medium, SemiBold) |
| Theme | Dark-first | **Light theme** — white/off-white backgrounds |
| Primary color | #A0D30A lime | **Black (#000000)** for buttons, headings, active states |
| Input style | Rounded 12px | **Pill/capsule (border-radius: 24px)** |
| Button style | Rounded 12px | **Full pill (border-radius: 100px)** |
| Auth flow | OTP → PIN set | **Phone + Security PIN** (PIN entered directly on login) |
| Card borders | Subtle hairline | **1px black border** on inputs; light gray cards |

---

## Font Specification

All screens use **Geist** — Google public font.

```
Geist:Bold      → font-weight: 700
Geist:SemiBold  → font-weight: 600
Geist:Medium    → font-weight: 500
Geist:Regular   → font-weight: 400
```

`NewSaleCartReview` also uses **Rubik** (Bold, Medium, Regular) — local font on the designer's machine, blocked for web. **Fallback to Geist** for those elements.

Google Fonts CSS2 import needed:
```
https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap
```

---

## Global Design Tokens (from Figma)

```
Background:       #FFFFFF (white)
Page bg alt:      #F5F5F5 (light gray — cards, strips)
Text primary:     #000000
Text secondary:   #888888
Text caption:     #888 / #999
Border default:   1px solid #000000 (inputs, outline buttons)
Border light:     1px solid #E5E5E5 (card separators, list rows)
Active/accent:    #000000 (filled buttons, active tabs, selected radio)
Badge paid:       #000000 bg, #FFFFFF text (pill badge)
Badge credit:     #FFFFFF bg, #000000 border + text (outline pill badge)
Category chip:    #000000 bg, #FFFFFF text (small pill, e.g. "Sprays")
Font:             Geist
Input radius:     24px (pill)
Button radius:    100px (full pill)
Card radius:      12px
Status bar:       iOS style, black icons
```

---

## Screen-by-Screen Specification

---

### SCREEN 1 — Splash Screen
**File:** `src/imports/SplashScreen/index.tsx`
**Figma node:** 5:13060

**Layout:**
- Full white screen, centered content vertically
- iOS status bar (44px) at top
- Centered logo block: black circle (80×80px, border-radius 40px) containing white sprout/plant SVG icon
- "AgriShop" — Geist Bold, 28px, black, centered, below logo
- "Smart Retail for Agriculture" — Geist Regular, 14px, #888, centered
- "EMPLOYEE FACING APP" — Geist Bold, 10px, #888, uppercase, pinned to bottom center

**Purpose:** Splash/loading screen shown on app launch before auth state is known.

---

### SCREEN 2 — Login
**File:** `src/imports/Login/index.tsx`
**Figma node:** 5:13080

**Layout:**
- White bg, iOS status bar
- Top area: "Welcome back" — Geist Bold, 28px, black
- Subtitle: "Sign in to your account" — Geist Regular, 14px, #888
- 24px gap
- Label: "PHONE NUMBER" — Geist Bold, 12px, black, uppercase
- Input: pill shape (h=48px, radius=24px), 1px solid black border, placeholder "e.g. +92 300 1234567" in #888
- 16px gap
- Label: "SECURITY PIN" — Geist Bold, 12px, black, uppercase
- Input: pill shape, 1px solid black border, placeholder "••••" (dots)
- Large gap (spacer to bottom)
- Bottom CTA area (fixed to bottom):
  - "Sign In" button — full black fill, white text, Geist Bold 16px, full pill, full width, h=52px
  - "Forgot PIN?" — Geist Regular, 14px, black, underlined, centered below button, 12px gap

**Padding:** 24px horizontal, 24px top content padding

**No OTP screen visible** in these frames — login uses Phone + PIN directly (returning user flow).
PIN setup after first OTP verify is a separate screen not yet imported.

---

### SCREEN 3 — Employee Dashboard
**File:** `src/imports/EmployeeDashboard/index.tsx`
**Figma node:** 5:13108

**Layout:**
- White bg, iOS status bar
- Greeting bar (padding 16px):
  - Left: "Good morning, Ahmed" — Geist Bold, 18px, black
  - Left sub: date — Geist Regular, 12px, #888
  - Right: Avatar badge — 36×36px, bg #F5F5F5, rounded-18px, letter "A" Geist Bold 14px black
- Metrics grid (4 cards, 2×2, gap 12px, padding 16px):
  - Card style: bg #F5F5F5, rounded-12px, padding 16px
  - Label: Geist Regular, 10px, #888, uppercase (e.g. "TODAY'S SALES")
  - Value: Geist Bold, 20px, black (e.g. "Rs. 45,200")
  - Cards: TODAY'S SALES | TRANSACTIONS | CUSTOMERS SERVED | CREDIT SALES
- "QUICK ACTIONS" label — Geist Bold, 12px, #888, uppercase, 16px padding
- Two buttons side by side (gap 12px, padding 16px horizontal):
  - "New Sale" — black fill, white text, Geist Medium, full pill, flex-1
  - "Record Payment" — white bg, black border, black text, Geist Medium, full pill, flex-1
  - Both h=48px
- "RECENT SALES" label — Geist Bold, 12px, #888, uppercase, padding 16px
- Sale list rows (no outer card, separated by bottom border #E5E5E5):
  - Left: customer name Geist Bold 14px black, time Geist Regular 12px #888
  - Right: amount Geist Medium 14px black + badge
  - Badge PAID: black bg, white text, Geist Bold 10px, pill (px-10 py-4)
  - Badge CREDIT: white bg, black border, black text, same size
- Bottom tab bar (fixed, bg white, top border #E5E5E5):
  - 5 tabs: Home | New Sale | Sales | Customers | Products
  - Icons: outlined SVG icons
  - Active tab: black icon + black label
  - Inactive: #888 icon + #888 label
  - New Sale tab: Plus circle icon

---

### SCREEN 4 — New Sale: Select Customer
**File:** `src/imports/NewSaleSelectCustomer/index.tsx`
**Figma node:** 5:13203

**Layout:**
- White bg, iOS status bar
- Navigation header (h=44px, padding 16px):
  - Left: back arrow (←) black SVG
  - Center: "New Sale" — Geist Bold, 16px, black
- Search bar (margin 16px):
  - Pill input, bg #F5F5F5, no border, h=44px
  - Search icon (magnifying glass) left, 8px gap
  - Placeholder: "Search customer by name or phone" — Geist Regular, 14px, #888
- "RECENT CUSTOMERS" — Geist Bold, 12px, #888, uppercase, 16px padding, 8px top margin
- Customer list (no outer card):
  - Each row: 16px padding, border-bottom 1px #E5E5E5
  - Left: name Geist Bold 14px black, phone Geist Regular 12px #888 below
  - Right: outstanding text right-aligned
    - Has balance: "Rs. X,XXX due" — Geist Medium, 12px, black
    - No balance: "No outstanding balance" — Geist Regular, 12px, #888
- "+ Add New Customer" row at bottom of list:
  - bg #F5F5F5, rounded, 16px padding
  - "+" icon + "Add New Customer" — Geist Medium, 14px, black
- Bottom tab bar (New Sale tab active)

---

### SCREEN 5 — New Sale: Browse Products
**File:** `src/imports/NewSaleBrowseProducts/index.tsx`
**Figma node:** 5:13291

**Layout:**
- White bg, iOS status bar
- Nav header: back arrow + "Select Products" centered — Geist Bold, 16px
- Sticky customer strip (bg #F5F5F5, padding 8px 16px):
  - "Customer: Rashid Ali" — Geist Regular, 12px, black
- Search bar (16px margin): pill, bg #F5F5F5, search icon, "Search products" placeholder
- Category filter row (padding 16px, gap 8px, scrollable):
  - "All" pill — black bg, white text, Geist Medium, 12px (active state)
  - "Sprays" pill — white bg, black border, Geist Medium, 12px
  - "Seeds" pill — white bg, black border, Geist Medium, 12px
- Product list rows (padding 16px, border-bottom #E5E5E5):
  - Left: product name Geist Bold 14px black, company name Geist Regular 12px #888
  - Category chip (small pill): black bg, white text, 10px Geist Bold, inline below company
  - Right: chevron → (black SVG)
- Bottom tab bar (New Sale active)

**Note:** "Fertilizer" category appears in design — extensible beyond just Sprays/Seeds.

---

### SCREEN 6 — New Sale: Product Variants
**File:** `src/imports/NewSaleProductVariants/index.tsx`
**Figma node:** 5:13392

**Layout:**
- White bg, iOS status bar
- Nav header: back arrow + "Product Details" centered
- Product header card (bg #F5F5F5, rounded-12px, padding 16px, margin 16px):
  - Left: product name Geist Bold 18px black, company Geist Regular 12px #888
  - Right: "Change" outline pill button — border 1px black, Geist Medium 12px, px-12 py-6
- "SELECT VARIANT" label — Geist Bold, 12px, black, uppercase, 16px padding
- Variant radio list (padding 16px, gap 8px):
  - Each row: border 1px black, rounded-12px, padding 16px
  - Left: variant name Geist Medium 14px black, price + stock Geist Regular 12px #888
  - Right: radio button (custom: black filled circle when selected, empty circle when not)
  - Selected row has 1px black border (same as unselected — border unchanged)
- "QUANTITY" label — Geist Bold, 12px, black, uppercase, 16px padding
- Quantity counter (padding 16px):
  - Full-width row, border 1px black rounded-12px, h=52px
  - Left: "–" button (Geist Bold, 20px, black, circular touch area)
  - Center: quantity number — Geist Bold, 20px, black
  - Right: "+" button — black circle bg, white "+", 36×36px rounded-full
  - Below: "X remaining in stock" — Geist Regular, 12px, #888
- "Add to Cart" — full black pill button, white Geist Bold, full width, h=52px, fixed bottom

---

### SCREEN 7 — New Sale: Cart Review & Payment
**File:** `src/imports/NewSaleCartReview/index.tsx`
**Figma node:** 5:13449

**Fonts used:** Geist (Bold, Medium, SemiBold, Regular) + Rubik (Bold, Medium, Regular) — Rubik is local font, use Geist fallback.

**Layout:**
- White bg, iOS status bar
- Nav header: back arrow + "Review & Payment" — Geist Bold 16px
- Customer info card (bg #F5F5F5, rounded-12px, padding 16px, margin 16px):
  - Top row: person icon + "Rashid Ali" Geist Bold 14px | "Credit Health: Good" Geist Regular 12px #888 (right)
  - Bottom row 2 cols:
    - OUTSTANDING CREDIT label 10px #888 uppercase / value Geist Bold 14px black
    - CREDIT LIMIT label 10px #888 uppercase / value Geist Bold 14px black
- Cart items (padding 16px, gap 12px, each bordered at bottom):
  - Product name — Geist Bold 14px black (right-aligned total amount Geist Bold 14px)
  - Variant detail row: "500ml - Rs. 2100 × 2" — Geist Regular 12px #888
  - Right side: quantity counter inline (–  2  +), smaller version
  - When qty=1: delete icon 🗑 (red circle, white trash icon) replaces "–" button
- "+ Add More Products" — full-width outline button (1px black border, rounded-12px, Geist Medium 14px), padding 16px horizontal
- "PAYMENT TYPE" label — Geist Bold 12px uppercase black
- Payment toggle (2 options side by side):
  - "Full Payment" — active: black bg white text pill
  - "Partial / Credit" — inactive: outline pill
- "AMOUNT RECEIVED" label + input (pill, 1px black border)
- Summary box (bg #000, rounded-12px, padding 16px, margin 16px):
  - Subtotal row — Geist Regular 14px white
  - Sales Tax (0%) — Geist Regular 14px white
  - Divider
  - Total Amount — Geist Bold 16px white (right: Rs. 9,200 white)
- "Proceed to Payment" — black pill button, full width, fixed bottom

---

### SCREEN 8 — Sale Success
**File:** `src/imports/SaleSuccess/index.tsx`
**Figma node:** 5:13540

**Layout:**
- White bg, iOS status bar
- Centered vertically (flex column, space top)
- Large check circle: black bg, 72×72px rounded-full, white checkmark SVG inside
- "Sale Completed!" — Geist Bold 24px black, centered, 16px top margin
- "Receipt generated successfully" — Geist Regular 14px #888, centered, 8px below
- Summary card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 24px):
  - Rows separated by border-bottom #F5F5F5:
    - Customer: [name] — label Geist Regular 14px #888, value Geist Bold 14px black
    - Total Amount: Rs. 9,200
    - Paid: Rs. 7,000
    - Outstanding: Rs. 2,200
    - Payment Method: Cash
    - Date & Time: Aug 8, 2026 — 2:34 PM
    - Sold by: Ahmed
- Bottom buttons (fixed, padding 16px, gap 12px):
  - "New Sale" — black fill, white text, full pill, full width
  - "View Receipt" — outline (1px black), black text, full pill, full width

---

### SCREEN 9 — Sales History: All Tab
**File:** `src/imports/SalesHistoryAll/index.tsx`
**Figma node:** 5:13587

**Layout:**
- White bg, iOS status bar
- Nav header: back arrow (left) + "Sales" (center, Geist Bold 16px) + filter icon (right, circle outline)
- Summary strip (bg #F5F5F5, padding 12px 16px):
  - "TODAY'S SALES" — Geist Regular 10px #888 uppercase left
  - "Rs. 84,500" — Geist Bold 16px black right
- Tab bar (underline style, padding 0 16px):
  - All | Credit | Paid
  - Active: Geist Bold 14px black, 2px black underline
  - Inactive: Geist Regular 14px #888
- Date filter pills (padding 16px, gap 8px):
  - "Today" — black bg white text pill (active)
  - "Yesterday" — outline pill
  - "This Week" — outline pill
- Sale list rows (padding 16px, border-bottom #E5E5E5):
  - Left: customer name Geist Bold 14px black; time + "Sold by Ahmed" Geist Regular 12px #888
  - Right: amount Geist Medium 14px black + badge
  - Badge PAID: black fill, white "PAID" text
  - Badge CREDIT: outline "CREDIT RS. 2,200" — shows credit amount outstanding

---

### SCREEN 10 — Sales History: Credit Tab
**File:** `src/imports/SalesHistoryCredit/index.tsx`
**Figma node:** 5:13705

**Layout:** Identical to Sales History All Tab except:
- Summary strip label: "CREDIT SALES"
- "Credit" tab is active (bold + underline)
- List shows only credit/partial payment sales
- Each row shows "CREDIT RS. X,XXX" outline badge

---

## Screens Documented So Far (18 total)

| # | Screen Name | Node | Batch |
|---|---|---|---|
| 1 | Splash Screen | 5:13060 | 1 |
| 2 | Login | 5:13080 | 1 |
| 3 | Employee Dashboard | 5:13108 | 1 |
| 4 | New Sale: Select Customer | 5:13203 | 1 |
| 5 | New Sale: Browse Products | 5:13291 | 1 |
| 6 | New Sale: Product Variants | 5:13392 | 1 |
| 7 | New Sale: Cart Review & Payment | 5:13449 | 1 |
| 8 | Sale Success | 5:13540 | 1 |
| 9 | Sales History: All Tab | 5:13587 | 1 |
| 10 | Sales History: Credit Tab | 5:13705 | 1 |
| 11 | Customer Profile | 5:13978 | 2 |
| 12 | Customer Purchase History | 5:14074 | 2 |
| 13 | Customer Payment History | 5:14192 | 2 |
| 14 | Record Customer Payment | 5:14298 | 2 |
| 15 | Products Catalog | 5:14343 | 2 |
| 16 | Product Detail | 5:14474 | 2 |
| 17 | Return: Select Items | 5:14558 | 2 |
| 18 | Sales History: Paid Tab | 5:14621 | 2 |
| 19 | Return: Confirm Return | 5:15178 | 3 |
| 20 | Search Screen | 5:15225 | 3 |
| 21 | Employee Settings | 5:15291 | 3 |
| 22 | Sale Detail | 5:15756 | 4 |

## Screens Still Missing (Not Yet Imported)

| Screen ID | Name | Notes |
|---|---|---|
| AUTH-OTP-VERIFY | OTP Verification | Build from AUTH.md spec |
| AUTH-PIN-SET | Set PIN (first login) | Build from AUTH.md spec |
| AUTH-NOT-REGISTERED | Not Registered | Build from AUTH.md spec |
| AUTH-DEACTIVATED | Deactivated | Build from AUTH.md spec |
| EMP-SALES-DETAIL | Sale Detail | ✅ Documented — node 5:15756 |
| EMP-SALES-RECEIPT | Receipt View | Not imported — derive from patterns |
| EMP-CUST-LIST | Customers List | Not imported — derive from CustomerProfile patterns |
| EMP-CUST-ADD | Add Customer | Not imported — standard form |
| EMP-RETURN-CONFIRM | Return Confirmation | ✅ Documented — node 5:15178 |
| SEARCH | Global Search Screen | ✅ Documented — node 5:15225 |
| EMP-SETTINGS | Employee Settings | ✅ Documented — node 5:15291 |

---

## Component Patterns Identified

### Pill Input
```
height: 48px
border-radius: 24px
border: 1px solid #000
padding: 0 16px
font: Geist Regular 14px
placeholder color: #888
bg: white
```

### Primary Button (Black Pill)
```
height: 52px
border-radius: 100px
background: #000
color: #fff
font: Geist Bold 16px
width: 100%
```

### Secondary Button (Outline Pill)
```
height: 52px
border-radius: 100px
background: white
border: 1px solid #000
color: #000
font: Geist Medium 16px
```

### Section Label
```
font: Geist Bold 12px
color: #888 or #000
text-transform: uppercase
letter-spacing: normal
padding: 16px horizontal
```

### Metric Card
```
background: #F5F5F5
border-radius: 12px
padding: 16px
label: Geist Regular 10px #888 uppercase
value: Geist Bold 20px black
```

### Sale Badge (PAID)
```
background: #000
color: #fff
font: Geist Bold 10px
padding: 4px 10px
border-radius: 100px
```

### Sale Badge (CREDIT)
```
background: white
border: 1px solid #000
color: #000
font: Geist Bold 10px
padding: 4px 10px
border-radius: 100px
```

### Category Chip (small)
```
background: #000
color: #fff
font: Geist Bold 10px
padding: 2px 8px
border-radius: 100px
```

### Customer Row
```
padding: 16px
border-bottom: 1px solid #E5E5E5
name: Geist Bold 14px black
phone: Geist Regular 12px #888
outstanding: Geist Medium 12px black (if balance) / Geist Regular 12px #888 (if none)
```

### Summary Dark Box
```
background: #000
border-radius: 12px
padding: 16px
text: white
rows: Geist Regular 14px
total row: Geist Bold 16px
divider: 1px solid rgba(255,255,255,0.2)
```

### Tab Bar (Bottom Nav)
```
background: white
border-top: 1px solid #E5E5E5
height: 83px (with home indicator)
icons: SVG, 24px
active: black icon + black Geist Bold 10px label
inactive: #888 icon + #888 Geist Regular 10px label
```

### Page Header (Nav Bar)
```
height: 44px
padding: 0 16px
back arrow: left, black SVG
title: center, Geist Bold 16px black
action icon: right (optional)
```

### Variant Radio Row
```
border: 1px solid #000
border-radius: 12px
padding: 16px
gap: between left content and right radio
name: Geist Medium 14px black
detail: Geist Regular 12px #888
radio: custom SVG circle (filled black when selected)
```

### Quantity Counter (Cart Review - inline)
```
row container: no border, inline
–: Geist Bold 20px, tap area
number: Geist Bold 20px black center
+: black circle 32×32px, white +
when qty=1: – replaced by red circle trash icon
```

### Quantity Counter (Variant Selector - full width)
```
container: border 1px black rounded-12px h=52px
–: left side, Geist Bold 20px
number: center, Geist Bold 20px
+: right side, black circle 36×36px white +
```

---

## Updated Font Requirements for index.css

Remove: Inter variable font import (or keep as secondary fallback)
Add: Geist from Google Fonts

```css
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap');
```

Font-face aliases for Figma's naming convention:
```css
/* Map Figma Geist aliases */
[class*="font-['Geist"] {
  font-family: 'Geist', system-ui, sans-serif !important;
}
```

---

## Updated Design Tokens for index.css

The app is **light-themed** (not dark). Update `:root` tokens:

```css
:root {
  --background: #FFFFFF;
  --foreground: #000000;
  --card: #F5F5F5;
  --card-foreground: #000000;
  --primary: #000000;
  --primary-foreground: #FFFFFF;
  --secondary: #F5F5F5;
  --secondary-foreground: #000000;
  --muted: #F5F5F5;
  --muted-foreground: #888888;
  --accent: #000000;
  --accent-foreground: #FFFFFF;
  --border: #000000;
  --border-light: #E5E5E5;
  --ring: rgba(0,0,0,0.3);
  --radius: 12px;
  --radius-pill: 100px;
  --radius-input: 24px;
}
```

---

---

## BATCH 2 — Additional Screens (8 screens, node IDs 5:13978–5:14621)

---

### SCREEN 11 — Customer Profile
**File:** `src/imports/CustomerProfile/index.tsx`
**Figma node:** 5:13978

**Layout:**
- White bg, iOS status bar
- Nav header: back arrow (←) + "Rashid Ali" centered (Geist Bold 16px) — title is customer name
- Info card (bg #F5F5F5, rounded-12px, padding 16px, margin 16px):
  - Row 1: phone icon + "0300-1234567" — Geist Regular 14px black
  - Row 2: pin/location icon + "Village Chak 45, Faisalabad" — Geist Regular 14px black
- "FINANCIAL SUMMARY" — section label (Geist Bold 12px #888 uppercase, 16px padding)
- 2×2 metric grid (gap 12px, padding 0 16px):
  - "TOTAL PURCHASES" / Rs. 85,400 — Geist Regular 10px #888 / Geist Bold 20px black
  - "TOTAL PAID" / Rs. 72,200
  - "OUTSTANDING" / Rs. 13,200
  - "CREDIT LIMIT" / Rs. 25,000
  - Cards: bg white, border 1px #E5E5E5, rounded-12px, padding 16px
- "QUICK ACTIONS" — section label
- Action rows (3, each with chevron →, border-bottom #E5E5E5):
  - "Purchase History" bold + "View past sales ledger" subtitle — Geist Bold 14px / Geist Regular 12px #888
  - "Payment History" + "Clearances and logs"
  - "Record Payment" + "Accept cash or bank transfer"
- Bottom tab bar: Customers tab active

---

### SCREEN 12 — Customer Purchase History
**File:** `src/imports/CustomerPurchaseHistory/index.tsx`
**Figma node:** 5:14074

**Layout:**
- White bg, iOS status bar
- Nav header: "← Profile" (back text, not just arrow) + "Purchase History" centered
- Customer strip (bg #F5F5F5, rounded-12px, padding 16px, margin 16px):
  - Top row: person icon + "Rashid Ali" Geist Bold 14px | "Credit Health: Good" Geist Regular 12px green (#22C55E) right
  - Bottom row 2 cols: "OUTSTANDING CREDIT" + value | "CREDIT LIMIT" + value
- Filter pills row (gap 8px, padding 0 16px, 12px top):
  - "All Purchases" — black bg, white text (active)
  - "This Month" — outline
  - "Last 3 Months" — outline
- Sale rows (border-bottom #E5E5E5):
  - Date: Geist Bold 14px black (e.g. "Aug 8, 2026")
  - Products: "Janja Spray, Wheat Seeds" — Geist Regular 12px #888
  - "Recorded by: Ahmed" — Geist Regular 12px #888
  - Right: amount Geist Medium 14px black + badge (PAID/CREDIT pill)
- Bottom tab bar: Customers active

**Credit Health color:** "Good" = green (#22C55E), "Warning" = orange, "Over Limit" = red

---

### SCREEN 13 — Customer Payment History
**File:** `src/imports/CustomerPaymentHistory/index.tsx`
**Figma node:** 5:14192

**Layout:**
- White bg, iOS status bar
- Nav header: "← Profile" + "Payment History" centered
- Same customer strip as Purchase History (Rashid Ali, Credit Health Good)
- Payment rows (border-bottom #E5E5E5, padding 16px):
  - Date: Geist Bold 14px black (e.g. "Aug 10, 2026")
  - "Method: Cash" — Geist Regular 12px #888
  - "Rec: Ahmed" — Geist Regular 12px #888
  - Right column:
    - Amount: "-Rs. 5,000" — Geist Bold 14px black (negative, no special color)
    - Balance: "Bal: Rs. 13,200" — Geist Regular 12px #888
- No filter tabs/pills on this screen (shows all payment history)
- Bottom tab bar: Customers active

---

### SCREEN 14 — Record Customer Payment
**File:** `src/imports/RecordCustomerPayment/index.tsx`
**Figma node:** 5:14298

**Layout:**
- White bg, iOS status bar
- Nav header: "← Profile" + "Record Payment" centered
- Outstanding card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px, centered):
  - "RASHID ALI OUTSTANDING" — Geist Regular 10px #888 uppercase centered
  - "Rs. 13,200" — Geist Bold 28px black centered (large, prominent)
- "AMOUNT TO PAY (RS.)" — section label (12px, uppercase)
- Pill input (h=48px, border 1px black, radius=24px) with numeric value "10,000"
- "PAYMENT METHOD" — section label
- Toggle (two pill buttons side by side):
  - "Cash" — black bg, white text (active)
  - "Bank Transfer" — outline, black text (inactive)
  - Both equal width, h=48px, radius=100px
- "NOTES (OPTIONAL)" — section label
- Notes textarea (border 1px #E5E5E5, rounded-12px, min-height 80px, padding 12px):
  - Placeholder: "e.g. Partial clearance for wheat bag purchase" — Geist Regular 14px #888
- Footer row: "New Balance after payment" — Geist Regular 14px #888 left | "Rs. 3,200" Geist Bold 14px black right
- "Confirm Payment" — full black pill button, full width, h=52px, fixed bottom, 16px padding

---

### SCREEN 15 — Products Catalog
**File:** `src/imports/ProductsCatalog/index.tsx`
**Figma node:** 5:14343

**Layout:**
- White bg, iOS status bar
- "Products" — page title centered (Geist Bold 16px), no back arrow (this is a tab root screen)
- Search bar (pill, bg #F5F5F5, no border, h=44px, margin 16px):
  - Search icon + "Search products" placeholder
- Category filter row (gap 8px, padding 0 16px):
  - "All" — black bg, white text (active)
  - "Sprays" — white bg, #888 border, #888 text (inactive — slightly muted)
  - "Seeds" — same inactive style
  - Note: Seeds pill border is light gray (#E5E5E5 or #CCC), not black border in this screen
- Product rows (border-bottom #E5E5E5, padding 16px):
  - Name: Geist Bold 14px black
  - Company: Geist Regular 12px #888
  - Row 3 (chips + status): category chip (black filled pill) + variant count text + stock status text
    - "In Stock" — Geist Medium 12px green (#22C55E)
    - "Low Stock" — Geist Medium 12px orange (#F59E0B or similar)
    - "Out of Stock" — Geist Medium 12px red (#EF4444)
  - Right: chevron → black
- Products shown: Janja Spray, Wheat Seeds 5kg, Fighter Insecticide, Premium Urea Bag, Cotton Seeds 2kg, Solupotasse 25kg
- "Fertilizer" is a third category shown (beyond Sprays/Seeds) — filters need All/Sprays/Seeds/Fertilizer or just All/Sprays/Seeds with Fertilizer grouping
- Bottom tab bar: Products tab active

---

### SCREEN 16 — Product Detail
**File:** `src/imports/ProductDetail/index.tsx`
**Figma node:** 5:14474

**Layout:**
- White bg, iOS status bar
- Nav header: "← Products" + "Product Details" centered
- Product name "Janja Spray" — Geist Bold 20px black, inline with "Sprays" category chip (black filled)
- Company row: "F" avatar (gray rounded square, 24×24px, Geist Bold 14px) + "FMC Corporation" Geist Regular 14px #888
- Info banner (bg #F5F5F5, rounded-12px, padding 12px 16px, margin 16px):
  - Lock icon + "Catalog editing restricted. Contact store admin for changes." — Geist Regular 12px #888
- "PACK SIZES AND PRICING" — section label
- Variant rows (in a card container, each bordered at bottom #E5E5E5):
  - Name: "1 Liter" — Geist Bold 14px black
  - Detail: "Rs. 2,500 — 20 units available" — Geist Regular 12px #888
  - Right: stock status chip
    - "In Stock" — outline chip, green text, green border
    - "Low Stock" — outline chip, red text, red border (used on "200ml" variant)
- Stock status chips on this screen use outline style (not filled)
- No price editing, no cost price shown to employee

---

### SCREEN 17 — Return: Select Items
**File:** `src/imports/ReturnSelectItems/index.tsx`
**Figma node:** 5:14558

**Layout:**
- White bg, iOS status bar
- Nav header: "← Sale #1042" (back shows sale reference) + "Process Return" centered
- Sale info card (bg #F5F5F5, rounded-12px, padding 16px, margin 16px):
  - "Sale #1042" — Geist Bold 14px black
  - "Rashid Ali" — Geist Regular 12px #888 left | date right "Aug 8, 2026" Geist Regular 12px #888
- "SELECT ITEMS & QUANTITY TO RETURN" — section label (uppercase, 12px #888)
- Item rows in card (border 1px #E5E5E5, rounded-12px, margin 16px):
  - Product name + total value (right): Geist Bold 14px black / Geist Bold 14px black
  - Detail row: "3 purchased · Rs. 1,400 each" — Geist Regular 12px #888
  - "Qty to return:" label (Geist Regular 12px #888) + quantity counter:
    - When qty=1: red trash icon (circle bg red, white trash SVG) replaces minus
    - Normal minus: gray circle with "−"
    - Plus: gray circle with "+"
    - Qty number: Geist Bold 16px black
- "Return Total" card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px):
  - "Return Total" — Geist Regular 14px black left | "Rs. 1,400" — Geist Bold 16px black right
- "Next" — full black pill button, h=52px, full width, fixed bottom

---

### SCREEN 18 — Sales History: Paid Tab
**File:** `src/imports/SalesHistoryPaid/index.tsx`
**Figma node:** 5:14621

**Layout:** Identical to Sales History All/Credit but:
- Summary strip label: "PAID SALES" / value: "Rs. 84,500"
- "Paid" tab is active (bold, underlined)
- List shows only paid sales — all rows show black "PAID" badge
- Filter pills: Today (active/filled), Yesterday, This Week
- Each row: customer name, time + "Sold by Ahmed", amount, PAID badge
- Right side: small circle icon in nav header (filter/search shortcut)
- Bottom tab bar: Sales active

---

## BATCH 2 — Component Patterns (New)

### Financial Metric Card (Customer Profile)
```
background: white
border: 1px solid #E5E5E5
border-radius: 12px
padding: 16px
label: Geist Regular 10px #888 uppercase
value: Geist Bold 20px black
```
(Differs from dashboard metric card which uses #F5F5F5 bg with no border)

### Quick Action Row (Customer Profile)
```
padding: 16px
border-bottom: 1px solid #E5E5E5
title: Geist Bold 14px black
subtitle: Geist Regular 12px #888
right: chevron SVG → black
```

### Customer Strip (shared: PurchaseHistory, PaymentHistory, CartReview)
```
background: #F5F5F5
border-radius: 12px
padding: 16px
margin: 16px
top-left: person icon + name (Geist Bold 14px)
top-right: "Credit Health: Good" (Geist Regular 12px, color by health status)
bottom-left: OUTSTANDING CREDIT label + value
bottom-right: CREDIT LIMIT label + value
```

### Payment Toggle (RecordPayment, CartReview)
```
Two equal buttons side by side
Active: black bg, white text, border-radius 100px
Inactive: white bg, #888 text (or black text), no border or subtle border
```

### Stock Status Inline Text (ProductCatalog)
```
In Stock: Geist Medium 12px #22C55E
Low Stock: Geist Medium 12px #F59E0B
Out of Stock: Geist Medium 12px #EF4444
```

### Stock Status Chip (ProductDetail variants)
```
In Stock: border 1px #22C55E, color #22C55E, bg white, radius 100px, 4px 10px padding
Low Stock: border 1px #EF4444, color #EF4444, bg white, same sizing
Out of Stock: border 1px #EF4444, color #EF4444, bg white
```

### Info Banner (ProductDetail — read-only notice)
```
background: #F5F5F5
border-radius: 12px
padding: 12px 16px
icon: lock SVG #888
text: Geist Regular 12px #888
```

### Return Quantity Counter (ReturnSelectItems)
```
Minus button: gray circle bg (#F5F5F5), "−" gray text — replaced by red circle + trash icon when qty=1
Plus button: gray circle bg (#F5F5F5), "+" gray text
Qty number: Geist Bold 16px black, centered
```

---

---

## BATCH 3 — New Screens (3 new, 5 confirmed duplicates)

Screens 19–26 imported. Images 0–4 confirm previously-documented layouts (no changes). New screens below.

---

### SCREEN 19 — Return: Confirm Return
**File:** `src/imports/ReturnConfirm/index.tsx`
**Figma node:** 5:15178

**Layout:**
- White bg, iOS status bar
- Nav header: "← Select Items" (back text) + "Confirm Return" centered
- Estimated refund card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px, centered):
  - "ESTIMATED REFUND" — Geist Regular 10px #888 uppercase centered
  - "Rs. 1,400" — Geist Bold 28px black centered (large, prominent)
- "RETURNING ITEMS" — section label (Geist Bold 12px #888 uppercase, 16px padding)
- Items card (border 1px #E5E5E5, rounded-12px, padding 16px):
  - Row: "Janja Spray 500ml × 1" left (Geist Regular 14px black) | "Rs. 1,400" right (Geist Bold 14px black)
- "RESOLUTION METHOD" — section label
- Toggle (two pill buttons side by side):
  - "Refund Cash" — black bg, white text (active)
  - "Credit Note" — white bg, #888 text (inactive, lighter border)
  - Both h=48px, radius=100px
- Info banner (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px):
  - Warning icon (triangle) + "REFUND PROCESSING" — Geist Bold 12px black uppercase
  - "Rs. 1,400 will be returned directly to customer Rashid Ali. Original invoice #1042 remains preserved." — Geist Regular 12px #888
- "Confirm Return" — full black pill button, h=52px, full width, fixed bottom

**Key data:** Resolution method: Refund Cash | Credit Note

---

### SCREEN 20 — Search Screen
**File:** `src/imports/SearchScreen/index.tsx`
**Figma node:** 5:15225

**Layout:**
- White bg, iOS status bar
- Top bar (no back arrow — full-width search):
  - Search input (pill, full width, h=44px, bg white, border 1px #E5E5E5):
    - Search icon left + typed text "Janja" + clear (×) icon right
  - "Cancel" text button right (Geist Regular 14px black, tap dismisses search)
- "QUICK ACCESS" — section label (Geist Bold 12px #888 uppercase, 16px padding)
- Quick access chips row (gap 8px, padding 0 16px, wrapping):
  - "Customers", "Products", "Sales", "Payments" — outline pill chips (border 1px #E5E5E5, Geist Medium 12px black)
- "RESULTS FOR 'JANJA'" — section label (Geist Bold 12px #888 uppercase)
- Result rows (border-bottom #E5E5E5, padding 16px):
  - Left: result name Geist Bold 14px black; detail Geist Regular 12px #888 below
  - Right: type badge (outline chip) — "Product" or "Customer" (border 1px #E5E5E5, Geist Regular 12px #888)
  - Example rows:
    - "Janja Spray" / "Product · FMC Corporation · 3 variants" / "Product" badge
    - "Janjua Brothers Farms" / "Customer · +92 301 4455889" / "Customer" badge
- "RECENT SEARCHES" — section label
- Recent search rows (padding 16px, border-bottom #E5E5E5):
  - Clock icon (gray) left + search term Geist Regular 14px black
  - Examples: "Rashid Ali", "Wheat Seeds 5kg", "Syngenta Fighter"
- No bottom tab bar on this screen (full-screen modal/overlay)

---

### SCREEN 21 — Employee Settings
**File:** `src/imports/EmployeeSettings/index.tsx`
**Figma node:** 5:15291

**Layout:**
- White bg, iOS status bar
- Nav header: "← Dashboard" (back text) + "Settings" centered
- Profile card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px):
  - Avatar: "AK" initials in gray rounded square (bg #F5F5F5, 48×48px, rounded-12px, Geist Bold 16px black)
  - Right of avatar:
    - "Ahmed Khan" — Geist Bold 16px black
    - "Store Associate · Emp #024" — Geist Regular 12px #888
    - "+92 301 5678901" — Geist Regular 12px #888
- "ACCOUNT & PREFERENCES" — section label (Geist Bold 12px #888 uppercase, 16px padding)
- Settings rows (in card container, border 1px #E5E5E5, rounded-12px, margin 0 16px):
  - Each row: padding 16px, border-bottom #E5E5E5
  - Row format: icon (black, 20px) + label (Geist Regular 14px black) | right value or chevron
  - "Change PIN" — lock icon + label + chevron →
  - "Notifications" — bell icon + label + chevron →
  - "Language" — globe icon + label | "English ›" (Geist Regular 14px #888 right)
  - "App Version" — info circle icon + label | "1.0.0" (Geist Regular 14px #888 right)
- "Sign Out" — outline pill button (border 1px #000, white bg, black text, Geist Bold 14px), full width, h=52px, fixed bottom, 16px padding
- No bottom tab bar (accessed from header, not tab bar)

---

---

## BATCH 4 — New Screens (1 new, 8 confirmed duplicates)

---

### SCREEN 22 — Sale Detail
**File:** `src/imports/SaleDetail/index.tsx`
**Figma node:** 5:15756

**Layout:**
- White bg, iOS status bar
- Nav header: "← Sales" (back text) + "Sale Details" centered
- Customer card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px):
  - "Rashid Ali" — Geist Bold 16px black
  - "Aug 8, 2026 — 2:34 PM" — Geist Regular 12px #888
  - "Employee: Ahmed" — Geist Regular 12px #888
  - Right: chevron → (tapping navigates to customer profile)
- "ITEMS SOLD" — section label (Geist Bold 12px #888 uppercase, 16px padding)
- Items card (border 1px #E5E5E5, rounded-12px, margin 0 16px):
  - Each row: product name Geist Bold 14px black | amount right Geist Bold 14px black
  - Below name: "Rs. 1,400 × 3" — Geist Regular 12px #888 (unit price × qty)
  - Border-bottom #E5E5E5 between rows
- Summary card (border 1px #E5E5E5, rounded-12px, padding 16px, margin 16px):
  - Subtotal row: Geist Regular 14px #888 left | Geist Bold 14px black right
  - Amount Paid row: same pattern
  - Outstanding Balance row: same pattern
  - "Method: Cash" — Geist Bold 14px black left
  - "Status" label below method — Geist Regular 12px #888
  - Right: "Partial / Credit" outline pill badge (border 1px #000, Geist Medium 12px)
- "Process Return" — outline pill button (border 1px #000, white bg, black text, Geist Bold 14px), full width, h=52px, fixed bottom, 16px padding
- No bottom tab bar (sub-page accessed from Sales list)

**Key observations:**
- Customer card has chevron — tapping navigates to CustomerProfile for that customer
- Payment status badge "Partial / Credit" uses outline style (same as CREDIT badge pattern)
- "Process Return" is the CTA — leads to ReturnSelectItems screen
- No "View Receipt" button on this screen (receipt is separate flow)
- No edit/void controls for employee (read-only view)

---

## BATCH 4 — Updated Mock Data (from duplicate screens)

These screens confirmed the same layouts with updated realistic mock data:

**NewSaleSelectCustomer-1 (5:15372):** 5 customers visible — Rashid Ali (Rs. 5,200 due), Muhammad Asif (Rs. 14,000 due), Zahid Khan (No outstanding), Imran Shah (Rs. 2,100 due), Kamil Hassan (No outstanding). Tab active = New Sale.

**NewSaleBrowseProducts-1 (5:15460):** Products list: Janja Spray (Sprays), Wheat Seeds 5kg (Seeds), Fighter Insecticide (Sprays), Premium Urea Bag (Fertilizer). No stock status shown inline on this screen (simpler than ProductsCatalog). Category chips only.

**NewSaleProductVariants-1 (5:15561):** Same layout, "1 Liter" selected, quantity=3, "35 remaining in stock" shown.

**NewSaleCartReview-1 (5:15618):** Two items in cart — Janja Spray 500ml (Rs. 2,100 × 2 = Rs. 4,200) and Janja Spray 1 Liter (Rs. 1,500 × 1, qty=1 so shows trash icon). Full Payment selected, "Amount Received: Rs. 9,200". Dark summary box shows Subtotal + Sales Tax (0%) + Total Amount.

**SalesHistoryAll-1 (5:15818):** 6 rows visible — mix of PAID and CREDIT RS. X,XXX badges. Confirms CREDIT badge shows outstanding amount inline.

**SalesHistoryCredit-1 (5:15936):** 2 rows — Muhammad Asif (CREDIT RS. 2,200), Liaquat Ali (CREDIT RS. 10,000).

**SalesHistoryPaid-1 (5:16022):** 4 rows — all PAID badges.

---

## Notes for Build Phase

1. **Font:** Geist everywhere. Rubik references in NewSaleCartReview should fall back to Geist.
2. **Light theme:** All screens are white/light gray — no dark mode in these frames.
3. **Bottom tab bar:** Fixed, 5 tabs. Persistent across all employee screens.
4. **iOS status bar:** Each frame includes a mock iOS status bar — implement as a fixed top component.
5. **Cart review** combines product browsing + payment in one long scrollable screen (not separate pages as planned — adjust routing if needed).
6. **Delete-on-1:** Cart review shows red trash icon when qty=1 — confirmed in design.
7. **Credit health indicator:** "Credit Health: Good / Warning / Over" shown in cart review header.
8. **Sales history tabs:** All / Credit / Paid with summary strip that changes per tab.
9. **"Record Payment" quick action** on dashboard — present alongside New Sale.
10. **Remaining screens** to be imported before build starts: OTP, PIN Set, Customers, Products, Customer Detail, Sale Detail, Receipt.
