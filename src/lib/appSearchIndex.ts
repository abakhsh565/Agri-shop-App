/**
 * The app's doors, in one place.
 *
 * The global search answers for the whole application, not only for the five stores it used to
 * read: every module and every settings screen is a destination with the words a shopkeeper
 * actually types for it. Each entry carries both languages, because the search must find an Urdu
 * word while the app is in Urdu and an English word when the owner types English — regardless of
 * the language currently chosen.
 *
 * Paths are relative to the shell; the screen chooses the admin or the employee address.
 */
export interface AppDestination {
  id: string;
  en: string;
  ur: string;
  path: string;
  /** The employee shell's address, when it differs from the admin one. */
  employeePath?: string;
  adminOnly?: boolean;
  employeeOnly?: boolean;
  /** A permission that hides the door when the account does not hold it. */
  permission?: string;
  keywords?: string[];
}

const CORE_KEYWORDS = ["screen", "page", "open", "go", "سیکرین", "صفحہ", "کھولیں"];

export const APP_DESTINATIONS: AppDestination[] = [
  { id: "dashboard", en: "Dashboard", ur: "ڈیش بورڈ", path: "/dashboard", keywords: ["home", "summary", "ہوم", "خلاصہ"] },
  { id: "assistant", en: "Assistant", ur: "اسسٹنٹ", path: "/assistant", keywords: ["help", "ai", "مدد", "سوال"] },
  { id: "new-sale", en: "New sale", ur: "نیا بل", path: "/sale", keywords: ["sale", "bill", "invoice", "receipt", "سیل", "بل", "رسید", "فروخت"] },
  { id: "sales", en: "Sales", ur: "فروخت", path: "/sales", permission: "sales.view", keywords: ["sales history", "sold", "سیل", "ہسٹری"] },
  { id: "invoices", en: "Invoices", ur: "بل / انوائس", path: "/invoices", adminOnly: true, permission: "sales.view", keywords: ["bills", "invoice list", "بل", "انوائس"] },
  { id: "new-invoice", en: "New invoice", ur: "نیا انوائس", path: "/invoices/new", adminOnly: true, permission: "sales.view", keywords: ["bill", "create", "receipt", "بل بنائیں", "رسید", "نیا بل"] },
  { id: "invoice-settings", en: "Invoice settings", ur: "انوائس سیٹنگز", path: "/invoices/settings", adminOnly: true, permission: "sales.view", keywords: ["design", "logo", "paper", "thermal", "receipt", "ڈیزائن", "لوگو", "کاغذ"] },
  { id: "purchases", en: "Purchases", ur: "خریداری", path: "/purchases", permission: "purchases.view", keywords: ["purchase history", "stock in", "خرید", "خریداری"] },
  { id: "new-purchase", en: "Record purchase", ur: "خرید درج کریں", path: "/purchases/new", permission: "purchases.view", keywords: ["add purchase", "supplier bill", "خرید", "بل"] },
  { id: "suppliers", en: "Suppliers", ur: "سپلائرز", path: "/companies", keywords: ["companies", "vendors", "سپلائر", "کمپنی"] },
  { id: "supplier-payments", en: "Supplier payments", ur: "سپلائر ادائیگیاں", path: "/purchases/payments", permission: "purchases.view", keywords: ["pay supplier", "payable", "ادائیگی", "سپلائر"] },
  { id: "customers", en: "Customers", ur: "گاہک", path: "/customers", keywords: ["buyers", "people", "گاہک", "خریدار"] },
  { id: "new-customer", en: "Add customer", ur: "نیا گاہک", path: "/customers/new", keywords: ["create customer", "نیا", "گاہک"] },
  { id: "outstanding", en: "Outstanding credit", ur: "باقی ادھار", path: "/customers/outstanding", adminOnly: true, permission: "payments.view", keywords: ["receivable", "udhaar", "ادھار", "باقی"] },
  { id: "customer-payments", en: "Customer payments", ur: "گاہک ادائیگیاں", path: "/customers/payments", adminOnly: true, permission: "payments.view", keywords: ["receive money", "وصولی", "ادائیگی"] },
  { id: "reminders", en: "Payment reminders", ur: "ادائیگی یاد دہانیاں", path: "/customers/reminders", adminOnly: true, permission: "alerts.view", keywords: ["remind", "یاد دہانی", "الرٹ"] },
  { id: "products", en: "Products", ur: "پروڈکٹس", path: "/products", keywords: ["items", "stock", "سامان", "اشیاء", "پروڈکٹ"] },
  { id: "new-product", en: "Add product", ur: "نئی پروڈکٹ", path: "/inventory/new", adminOnly: true, permission: "products.create", keywords: ["item", "سامان", "نئی"] },
  { id: "catalogue", en: "Inventory catalogue", ur: "انوینٹری کیٹلاگ", path: "/inventory/catalogue", adminOnly: true, permission: "products.view", keywords: ["stock list", "سامان", "کیٹلاگ"] },
  { id: "categories", en: "Categories", ur: "کیٹیگریز", path: "/inventory/categories", adminOnly: true, permission: "products.view", keywords: ["groups", "قسم", "کیٹیگری"] },
  { id: "stock-values", en: "Stock value", ur: "اسٹاک ویلیو", path: "/inventory/stockvalues", employeePath: "/stock", permission: "products.view", keywords: ["inventory value", "stock", "اسٹاک", "مال"] },
  { id: "stock-movements", en: "Stock movements", ur: "اسٹاک حرکات", path: "/inventory/movements", adminOnly: true, permission: "products.view", keywords: ["adjustments", "history", "اسٹاک", "حرکت"] },
  { id: "reorder", en: "Reorder suggestions", ur: "ری آرڈر", path: "/inventory/reorder", adminOnly: true, permission: "products.view", keywords: ["low stock", "buy again", "اسٹاک کم", "ری آرڈر"] },
  { id: "barcodes", en: "Barcodes", ur: "بارکوڈز", path: "/inventory/barcodes", adminOnly: true, permission: "products.view", keywords: ["labels", "scan", "بارکوڈ", "لیبل"] },
  { id: "money", en: "Money statement", ur: "رقم / کھاتہ", path: "/payments", employeePath: "/finance", permission: "payments.view", keywords: ["expenses", "cash", "ledger", "اخراجات", "کیش", "رقم"] },
  { id: "record-money", en: "Record money", ur: "رقم درج کریں", path: "/settings/hub/finance/record", adminOnly: true, permission: "payments.view", keywords: ["expense", "income", "drawing", "خرچ", "آمدنی"] },
  { id: "reports", en: "Reports", ur: "رپورٹس", path: "/reports", permission: "reports.view", keywords: ["report", "numbers", "رپورٹ"] },
  { id: "profit", en: "Profit report", ur: "منافع رپورٹ", path: "/reports/profit", adminOnly: true, permission: "reports.view", keywords: ["profit", "loss", "منافع", "نقصان"] },
  { id: "employees", en: "Employees", ur: "ملازمین", path: "/employees", adminOnly: true, permission: "employees.view", keywords: ["staff", "team", "ملازم", "ٹیم"] },
  { id: "activity", en: "Activity log", ur: "ایکٹیویٹی لاگ", path: "/activity", permission: "activity.view", keywords: ["audit", "history", "who did", "لاگ", "آڈٹ"] },
  { id: "roles", en: "Roles and access", ur: "رولز اور اجازت", path: "/settings/roles", adminOnly: true, permission: "settings.view", keywords: ["permissions", "role", "اجازت", "رول"] },
  { id: "branches", en: "Branches", ur: "برانچز", path: "/settings/hub/branches", adminOnly: true, permission: "settings.view", keywords: ["shops", "branch", "برانچ", "شاخ"] },
  { id: "business-profile", en: "Business profile", ur: "کاروباری پروفائل", path: "/settings/business", adminOnly: true, permission: "settings.view", keywords: ["shop details", "logo", "پروفائل", "دکان"] },
  { id: "settings", en: "Settings", ur: "سیٹنگز", path: "/settings", keywords: ["preferences", "سیٹنگ", "ترتیبات"] },
  { id: "security", en: "Security", ur: "سیکیورٹی", path: "/settings/security", adminOnly: true, permission: "settings.view", keywords: ["pin", "password", "سیکیورٹی", "پن"] },
  { id: "preferences", en: "Preferences", ur: "ترجیحات", path: "/settings/preferences", adminOnly: true, permission: "settings.view", keywords: ["language", "theme", "زبان", "تھیم"] },
  { id: "profile", en: "Profile details", ur: "پروفائل تفصیلات", path: "/settings/profile", adminOnly: true, permission: "settings.view", keywords: ["account", "profile", "پروفائل", "اکاؤنٹ"] },
  { id: "finance-hub", en: "Finance settings", ur: "مالیات سیٹنگز", path: "/settings/hub/finance", adminOnly: true, permission: "settings.view", keywords: ["finance", "مالیات", "کھاتہ"] },
  { id: "sales-hub", en: "Sales settings", ur: "فروخت سیٹنگز", path: "/settings/hub/sales", adminOnly: true, permission: "settings.view", keywords: ["sales", "فروخت"] },
  { id: "inventory-hub", en: "Inventory settings", ur: "انوینٹری سیٹنگز", path: "/settings/hub/inventory", adminOnly: true, permission: "settings.view", keywords: ["stock", "اسٹاک", "انوینٹری"] },
  { id: "customers-hub", en: "Customer settings", ur: "گاہک سیٹنگز", path: "/settings/hub/customers", adminOnly: true, permission: "settings.view", keywords: ["credit", "گاہک", "ادھار"] },
  { id: "purchases-hub", en: "Purchase settings", ur: "خریداری سیٹنگز", path: "/settings/hub/purchases", adminOnly: true, permission: "settings.view", keywords: ["supplier", "خریداری", "سپلائر"] },
  { id: "people-hub", en: "People settings", ur: "افراد سیٹنگز", path: "/settings/hub/people", adminOnly: true, permission: "settings.view", keywords: ["employees", "roles", "ملازم", "رول"] },
  { id: "co-owners", en: "Co-owners", ur: "شریک مالک", path: "/settings/hub/people/co-owners", adminOnly: true, permission: "settings.view", keywords: ["owner", "partner", "مالک", "شریک"] },
  { id: "reminders-book", en: "Payment reminder book", ur: "ادائیگی یاد دہانی کتاب", path: "/settings/hub/finance/reminders", adminOnly: true, permission: "payments.view", keywords: ["reminder", "یاد دہانی", "ادائیگی"] },
  { id: "receivables", en: "Customer receivables", ur: "گاہک وصولیاں", path: "/settings/overview/customers", adminOnly: true, permission: "payments.view", keywords: ["credit", "udhaar", "ادھار", "وصولی"] },
  { id: "payables", en: "Supplier payables", ur: "سپلائر واجبات", path: "/settings/overview/suppliers", adminOnly: true, permission: "purchases.view", keywords: ["payable", "supplier", "واجب", "سپلائر"] },
  { id: "draft-carts", en: "Draft carts", ur: "ڈرافٹ بل", path: "/sale/carts", keywords: ["parked sale", "draft", "ڈرافٹ", "بل"] },
  { id: "app-permissions", en: "App permissions", ur: "ایپ اجازتیں", path: "/settings/permissions", adminOnly: true, permission: "settings.view", keywords: ["camera", "location", "اجازت"] },
  { id: "messages", en: "Messages", ur: "پیغامات", path: "/messages", adminOnly: true, keywords: ["inbox", "chat", "پیغام", "چیٹ"] },
  { id: "alerts", en: "Alerts and reminders", ur: "الرٹس", path: "/alerts/reminders", adminOnly: true, permission: "alerts.view", keywords: ["due", "reminder", "الرٹ", "یاد دہانی"] },
  { id: "notifications", en: "Notifications", ur: "اطلاعات", path: "/notifications", keywords: ["updates", "اطلاع", "خبر"] },
  { id: "guide", en: "Guide", ur: "گائیڈ", path: "/guide", keywords: ["help", "how to", "مدد", "طریقہ"] },
  { id: "team", en: "Team", ur: "ٹیم", path: "/team", employeeOnly: true, permission: "employees.view", keywords: ["staff", "ملازم"] },
  { id: "more", en: "More", ur: "مزید", path: "/more", keywords: ["menu", "all", "مینو", "سب"] },
  { id: "history", en: "History", ur: "ہسٹری", path: "/history", adminOnly: true, keywords: ["records", "books", "تاریخ", "ریکارڈ"] },
  { id: "history-sales", en: "Sales history", ur: "سیل ہسٹری", path: "/history/sales", adminOnly: true, permission: "sales.view", keywords: ["sold", "فروخت", "تاریخ"] },
  { id: "history-invoices", en: "Invoice history", ur: "انوائس ہسٹری", path: "/history/invoices", adminOnly: true, permission: "sales.view", keywords: ["bills", "بل", "تاریخ"] },
  { id: "history-purchases", en: "Purchases history", ur: "خرید ہسٹری", path: "/history/purchases", adminOnly: true, permission: "purchases.view", keywords: ["bought", "خرید", "تاریخ"] },
  { id: "history-returns", en: "Sales returns", ur: "واپسیاں", path: "/history/returns", adminOnly: true, permission: "sales.view", keywords: ["refund", "واپس", "رقم"] },
  { id: "history-customer-payments", en: "Customer payment history", ur: "گاہک ادائیگی ہسٹری", path: "/history/customer-payments", adminOnly: true, permission: "payments.view", keywords: ["received", "وصولی", "ادائیگی"] },
  { id: "history-supplier-payments", en: "Supplier payment history", ur: "سپلائر ادائیگی ہسٹری", path: "/history/supplier-payments", adminOnly: true, permission: "purchases.view", keywords: ["paid", "ادائیگی", "سپلائر"] },
  { id: "history-money", en: "Expenses and money", ur: "اخراجات و رقم", path: "/history/money", adminOnly: true, permission: "payments.view", keywords: ["expense", "cash", "خرچ", "رقم"] },
  { id: "history-stock", en: "Stock movement history", ur: "اسٹاک ہسٹری", path: "/history/stock", adminOnly: true, permission: "products.view", keywords: ["adjustment", "اسٹاک", "حرکت"] },
];

/** Add the shared words once, so an entry needs only its own synonyms. */
export function destinationKeywords(entry: AppDestination): string[] {
  return [entry.en, entry.ur, entry.path.replace(/[/-]/g, " "), ...CORE_KEYWORDS, ...(entry.keywords ?? [])];
}
