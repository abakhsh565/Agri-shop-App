import { createBrowserRouter, Navigate } from "react-router-dom";
import React, { Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

// Auth
import SplashPage from "@/pages/auth/SplashPage";
import LoginPage from "@/pages/auth/LoginPage";
import RequestAccessPage from "@/pages/auth/RequestAccessPage";
import OTPVerifyPage from "@/pages/auth/OTPVerifyPage";
import AccountReadyPage from "@/pages/auth/AccountReadyPage";
import PINSetPage from "@/pages/auth/PINSetPage";
import PINLoginPage from "@/pages/auth/PINLoginPage";
import ForgotPINPage from "@/pages/auth/ForgotPINPage";
import NotRegisteredPage from "@/pages/auth/NotRegisteredPage";
import DeactivatedPage from "@/pages/auth/DeactivatedPage";
import UnderReviewPage from "@/pages/auth/UnderReviewPage";
import RejectedPage from "@/pages/auth/RejectedPage";
import PermissionGuard from "@/components/auth/PermissionGuard";
import LocationPickerPage from "@/pages/shared/LocationPickerPage";

// Registration
import RegisterPhonePage from "@/pages/register/RegisterPhonePage";
import RegisterOTPPage from "@/pages/register/RegisterOTPPage";
import RegisterShopDetailsPage from "@/pages/register/RegisterShopDetailsPage";
import RegisterStatusPage from "@/pages/register/RegisterStatusPage";

// Layout
import EmployeeLayout from "@/components/layout/EmployeeLayout";
import AppGuidePage from "@/pages/shared/AppGuidePage";
import IntroPage from "@/pages/onboarding/IntroPage";
import AdminLayout from "@/components/layout/AdminLayout";

// Admin pages
const AdminDashboardPage = React.lazy(() => import("@/pages/admin/dashboard/AdminDashboardPage"));
const AdminSalesListPage = React.lazy(() => import("@/pages/admin/sales/AdminSalesListPage"));
// The Sales section's own screen. It is not `SectionHubPage` because the section has a quick
// action, today's two figures and a search of its own; the rows it does show still come from the
// same catalogue (`lib/settingsHub`), so the menu and the screen cannot disagree.
const AdminSalesSectionPage = React.lazy(() => import("@/pages/admin/sales/AdminSalesSectionPage"));
// Products & Inventory's own screen, for the same reason: a quick action, four counts and a
// search of its own, with the section's rows still read from `lib/settingsHub`.
const AdminInventorySectionPage = React.lazy(() => import("@/pages/admin/inventory/AdminInventorySectionPage"));
const StockManagementPage = React.lazy(() => import("@/pages/admin/inventory/StockManagementPage"));
// One sale record for both shells. It was two pages that drifted apart (one printed cost and
// profit under every line, the other did not; neither showed the sale number), so the screen
// is shared and the numbers it shows follow the signed-in role.
const SaleDetailView = React.lazy(() => import("@/components/sales/SaleDetailView"));

import AdminMessagesPage from "@/pages/admin/messages/AdminMessagesPage";
import BranchDetailPage from "@/pages/admin/more/BranchDetailPage";
const EmployeesListPage = React.lazy(() => import("@/pages/admin/employees/EmployeesListPage"));
const EmployeeDetailPage = React.lazy(() => import("@/pages/admin/employees/EmployeeDetailPage"));
import CompaniesListPage from "@/pages/admin/companies/CompaniesListPage";
import AddCompanyPage from "@/pages/admin/companies/AddCompanyPage";
import CompanyDetailPage, { SupplierDetailRedirect } from "@/pages/admin/companies/CompanyDetailPage";
import AdminSettingsPage from "@/pages/admin/settings/AdminSettingsPage";
import ProfileDetailsPage from "@/pages/admin/settings/ProfileDetailsPage";
import SectionHubPage from "@/pages/admin/settings/SectionHubPage";
import AdminBranchesSectionPage from "@/pages/admin/settings/AdminBranchesSectionPage";
import BusinessProfilePage from "@/pages/admin/settings/BusinessProfilePage";
import BusinessOverviewPage from "@/pages/admin/settings/BusinessOverviewPage";
// The two collection screens the overview's balance cards open. They answer the money question
// the card asks, not the catalogue question the Customers and Suppliers lists answer.
import CustomerReceivablePage from "@/pages/admin/settings/CustomerReceivablePage";
import SupplierPayablePage from "@/pages/admin/settings/SupplierPayablePage";
// The pending and overdue books behind the collection tiles, and one supplier's own payable page.
import CustomerCreditPage from "@/pages/admin/settings/CustomerCreditPage";
import SupplierCreditPage from "@/pages/admin/settings/SupplierCreditPage";
import RolesAccessPage from "@/pages/admin/settings/RolesAccessPage";
import AdminNotificationsPage from "@/pages/admin/notifications/AdminNotificationsPage";
import AddEmployeePage from "@/pages/admin/employees/AddEmployeePage";
import EmployeeAccessRequestsPage from "@/pages/admin/employees/EmployeeAccessRequestsPage";
import EmployeeAccessRequestDetailPage from "@/pages/admin/employees/EmployeeAccessRequestDetailPage";
const AdminPurchasesPage = React.lazy(() => import("@/pages/admin/purchases/AdminPurchasesPage"));
const RecordPurchasePage = React.lazy(() => import("@/pages/admin/purchases/RecordPurchasePage"));
const SupplierPaymentsPage = React.lazy(() => import("@/pages/admin/purchases/SupplierPaymentsPage"));
import RecordSupplierPaymentPage from "@/pages/admin/payments/RecordSupplierPaymentPage";
const AdminReportsPage = React.lazy(() => import("@/pages/admin/reports/AdminReportsPage"));
// The Reports *hub* and its Profit screen are eager: both are entered from Settings, whose
// section pages are already in the shell's first bundle, and one is the parent of the other.
import AdminReportsHubPage from "@/pages/admin/reports/AdminReportsHubPage";
import AdminProfitReportPage from "@/pages/admin/reports/AdminProfitReportPage";
// Employees & Access: the directory, its branch grouping, and the per-employee history. All
// three are entered from Settings, and each one's back returns to the directory.
import AdminPeopleHubPage from "@/pages/admin/people/AdminPeopleHubPage";
// One role's own screen: what it is called and what it opens. Opened from the roles list, so it
// stays eager with the rest of the Employees & Access group.
import RoleEditorPage from "@/pages/admin/people/RoleEditorPage";
import AdminBranchAssignmentsPage from "@/pages/admin/people/AdminBranchAssignmentsPage";
import AdminEmployeeActivityPage from "@/pages/admin/people/AdminEmployeeActivityPage";
import AdminEmployeeActivityDetailPage from "@/pages/admin/people/AdminEmployeeActivityDetailPage";
const InventoryAdjustPage = React.lazy(() => import("@/pages/admin/inventory/InventoryAdjustPage"));
const AddProductPage = React.lazy(() => import("@/pages/admin/inventory/AddProductPage"));
// The shop's own catalogue (0259): the Products menu, its shelves and its units.
const InventoryCataloguePage = React.lazy(() => import("@/pages/admin/inventory/InventoryCataloguePage"));
const CategoriesPage = React.lazy(() => import("@/pages/admin/inventory/CategoriesPage"));
const CategoryFormPage = React.lazy(() => import("@/pages/admin/inventory/CategoryFormPage"));
const UnitsPage = React.lazy(() => import("@/pages/admin/inventory/UnitsPage"));
const UnitFormPage = React.lazy(() => import("@/pages/admin/inventory/UnitFormPage"));
import PurchaseDetailPage from "@/pages/admin/purchases/PurchaseDetailPage";
import StockMovementHistoryPage from "@/pages/admin/inventory/StockMovementHistoryPage";
import ReorderSuggestionsPage from "@/pages/admin/inventory/ReorderSuggestionsPage";
import DailyCashReconciliationPage from "@/pages/admin/payments/DailyCashReconciliationPage";
import CashPositionPage from "@/pages/admin/payments/CashPositionPage";

// Employee pages
const DashboardPage = React.lazy(() => import("@/pages/employee/dashboard/DashboardPage"));
// One screen, both shells: the assistant runs on the session that is already open, so there is
// nothing about it that belongs to the owner side or the employee side.
const AssistantPage = React.lazy(() => import("@/pages/assistant/AssistantPage"));
import SelectCustomerPage from "@/pages/employee/sale/SelectCustomerPage";
import BrowseProductsPage from "@/pages/employee/sale/BrowseProductsPage";
import VariantSelectorPage from "@/pages/employee/sale/VariantSelectorPage";
import CartPage from "@/pages/employee/sale/CartPage";
import SaleSuccessPage from "@/pages/employee/sale/SaleSuccessPage";
const SalesListPage = React.lazy(() => import("@/pages/employee/sales/SalesListPage"));
const CustomersListPage = React.lazy(() => import("@/pages/employee/customers/CustomersListPage"));
const CustomerProfilePage = React.lazy(() => import("@/pages/employee/customers/CustomerProfilePage"));
import CustomerPurchaseHistoryPage from "@/pages/employee/customers/CustomerPurchaseHistoryPage";
import CustomerPaymentHistoryPage from "@/pages/employee/customers/CustomerPaymentHistoryPage";
import ReminderHistoryPage from "@/pages/employee/customers/ReminderHistoryPage";
import RecordCustomerPaymentPage from "@/pages/employee/customers/RecordCustomerPaymentPage";
import AddCustomerPage from "@/pages/employee/customers/AddCustomerPage";
const ProductsListPage = React.lazy(() => import("@/pages/employee/products/ProductsListPage"));
const ProductDetailPage = React.lazy(() => import("@/pages/employee/products/ProductDetailPage"));
import ReturnSelectItemsPage from "@/pages/employee/returns/ReturnSelectItemsPage";
import ReturnConfirmPage from "@/pages/employee/returns/ReturnConfirmPage";
import ReturnSuccessPage from "@/pages/employee/returns/ReturnSuccessPage";
import SearchPage from "@/pages/employee/search/SearchPage";
import SettingsPage from "@/pages/employee/settings/SettingsPage";
import MyReportsPage from "@/pages/employee/reports/MyReportsPage";
import ActivityLogPage from "@/pages/employee/activity/ActivityLogPage";
import EmployeeNotificationsPage from "@/pages/employee/notifications/EmployeeNotificationsPage";
import EmployeeMorePage from "@/pages/employee/more/MorePage";
const BarcodeGeneratePage = React.lazy(() => import("@/pages/admin/inventory/BarcodeGeneratePage"));
import AdminReturnSelectItemsPage from "@/pages/admin/returns/AdminReturnSelectItemsPage";
import AdminReturnConfirmPage from "@/pages/admin/returns/AdminReturnConfirmPage";
import AdminReturnSuccessPage from "@/pages/admin/returns/AdminReturnSuccessPage";
import CreditOverridesPage from "@/pages/admin/alerts/CreditOverridesPage";
import CreditOverrideDetailPage from "@/pages/admin/alerts/CreditOverrideDetailPage";
import CreditRequestDetailPage from "@/pages/admin/alerts/CreditRequestDetailPage";
import RemindersOverviewPage from "@/pages/admin/alerts/RemindersOverviewPage";
// Customers & Credit: the section hub and the three ledgers its rows open. Payments is the
// existing `/payments` screen, rebuilt as the ledger of money that actually moved.
import AdminCustomersSectionPage from "@/pages/admin/customers/AdminCustomersSectionPage";
// Purchases & Suppliers: the section hub built around the payable book, like Customers & Credit.
import AdminPurchasesSectionPage from "@/pages/admin/purchases/AdminPurchasesSectionPage";
// Finance: recorded cash, the two balances and the section's four jobs on one screen.
import AdminFinanceSectionPage from "@/pages/admin/finance/AdminFinanceSectionPage";
import RecordMoneyPage from "@/pages/admin/finance/RecordMoneyPage";
import MoneyStatementPage from "@/pages/admin/finance/MoneyStatementPage";
import OutstandingCreditPage from "@/pages/admin/customers/OutstandingCreditPage";
import CreditLimitRequestsPage from "@/pages/admin/customers/CreditLimitRequestsPage";
import CustomerPaymentsPage from "@/pages/admin/customers/CustomerPaymentsPage";
import PaymentRemindersPage from "@/pages/admin/customers/PaymentRemindersPage";
import PaymentRemindersBookPage from "@/pages/admin/finance/PaymentRemindersBookPage";
import InventoryAlertsPage from "@/pages/admin/alerts/InventoryAlertsPage";
import ExpiryAlertsPage from "@/pages/admin/alerts/ExpiryAlertsPage";
import GroupDetailPage from "@/pages/admin/alerts/GroupDetailPage";

export const router = createBrowserRouter([
  { path: "/", element: <SplashPage /> },
  // Shown once per device, before sign-in: what the app is for, in three screens.
  { path: "/welcome", element: <IntroPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/login/request-access", element: <RequestAccessPage /> },
  { path: "/login/otp", element: <OTPVerifyPage /> },
  // A brand-new account lands here instead of on the PIN keypad: signed in, told so, and
  // offered the PIN as the next small step rather than as the first thing the app says.
  { path: "/login/account-ready", element: <AccountReadyPage /> },
  { path: "/login/pin-set", element: <PINSetPage /> },
  { path: "/login/pin", element: <PINLoginPage /> },
  { path: "/login/forgot-pin", element: <ForgotPINPage /> },
  { path: "/login/not-registered", element: <NotRegisteredPage /> },
  { path: "/login/deactivated", element: <DeactivatedPage /> },
  { path: "/login/under-review", element: <UnderReviewPage /> },
  { path: "/login/rejected", element: <RejectedPage /> },

  // Choosing a location is a process — search, check, retry — so it is a page of its own,
  // opened by any field that needs a point. It returns the choice through the router state.
  { path: "/pick-location", element: <LocationPickerPage /> },

  // Registration flow
  { path: "/register", element: <RegisterPhonePage /> },
  { path: "/register/otp", element: <RegisterOTPPage /> },
  { path: "/register/shop-details", element: <RegisterShopDetailsPage /> },
  { path: "/register/status", element: <RegisterStatusPage /> },

  {
    element: <ProtectedRoute allowedRoles={["admin"]} />,
    children: [{
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: "dashboard",  element: <AdminDashboardPage /> },
      { path: "assistant",  element: <AssistantPage /> },
      // The fifth tab used to open this. It listed the same business destinations the Settings
      // hub already owns, so the app had two menu trees; the tab now opens Settings itself and
      // this address redirects there, which keeps old links and bookmarks working.
      { path: "more",       element: <Navigate to="/admin/settings" replace /> },
      { path: "messages",   element: <AdminMessagesPage /> },
      { path: "guide",      element: <AppGuidePage /> },
      { path: "search", element: <SearchPage /> },

      // ── Customers (requires customers.view) ──────────────────────────────
      { element: <PermissionGuard requires="customers.view" />,
        children: [
          { path: "customers",  element: <CustomersListPage /> },
          { path: "customers/new", element: <AddCustomerPage /> },
          // The three ledgers the Customers & Credit hub opens. They are declared BEFORE the
          // profile route: `customers/:customerId` would otherwise swallow `outstanding` and
          // open a customer called "outstanding".
          { path: "customers/outstanding", element: <OutstandingCreditPage /> },
          // The hub's "Customer payments" row has its own book: customer receipts only, never the
          // supplier side of the ledger. It keeps the grant money movement has always needed,
          // falling back to the customer list for an account that may read customers but not
          // payments.
          { element: <PermissionGuard requires="payments.view" fallback="/admin/customers" />,
            children: [{ path: "customers/payments", element: <CustomerPaymentsPage /> }] },
          // A credit request is a decision about money and a follow-up list is the Action
          // Center's work, so both keep the grant their old screens had (`alerts.view`)
          // instead of opening to anyone who may read customers.
          { element: <PermissionGuard requires="alerts.view" fallback="/admin/customers" />,
            children: [
              { path: "customers/credit-requests", element: <CreditLimitRequestsPage /> },
              { path: "customers/reminders", element: <PaymentRemindersPage /> },
            ] },
          { path: "customers/:customerId", element: <CustomerProfilePage /> },
          { path: "customers/:customerId/purchases", element: <CustomerPurchaseHistoryPage /> },
          { path: "customers/:customerId/payments",  element: <CustomerPaymentHistoryPage /> },
          { path: "customers/:customerId/record-payment", element: <RecordCustomerPaymentPage /> },
          { path: "customers/:customerId/reminders", element: <ReminderHistoryPage /> },
        ] },

      // ── Products (requires products.view) ────────────────────────────────
      { element: <PermissionGuard requires="products.view" />,
        children: [
          { path: "products",   element: <ProductsListPage /> },
          { path: "products/:productId", element: <ProductDetailPage /> },
          { path: "inventory/new", element: <AddProductPage /> },
          // Products → All products / Categories / Units. The forms are the only routes that
          // need write rights; the lists are readable by anyone who may see products.
          { path: "inventory/catalogue", element: <InventoryCataloguePage /> },
          { path: "inventory/categories", element: <CategoriesPage /> },
          { path: "inventory/units", element: <UnitsPage /> },
          { element: <PermissionGuard requires="products.edit" fallback="/admin/inventory/catalogue" />,
            children: [
              { path: "inventory/categories/new", element: <CategoryFormPage /> },
              { path: "inventory/categories/:categoryId", element: <CategoryFormPage /> },
              { path: "inventory/units/new", element: <UnitFormPage /> },
              { path: "inventory/units/:unitId", element: <UnitFormPage /> },
            ] },
          { path: "inventory/:productId/edit", element: <AddProductPage /> },
          { path: "inventory/:productId/adjust", element: <InventoryAdjustPage /> },
          { path: "inventory/stockvalues", element: <StockManagementPage /> },
          // The old address keeps working: a bookmark, a notification or a link already shared
          // before the rename still lands on the screen it named.
          { path: "inventory/stock", element: <Navigate to="/admin/inventory/stockvalues" replace /> },
          { path: "inventory/movements", element: <StockMovementHistoryPage /> },
          { path: "inventory/reorder", element: <ReorderSuggestionsPage /> },
          { path: "inventory/barcodes", element: <BarcodeGeneratePage /> },
        ] },

      // ── Sales (requires sales.view) ──────────────────────────────────────
      { element: <PermissionGuard requires="sales.view" />,
        children: [
          { path: "sale",       element: <SelectCustomerPage /> },
          { path: "sale/products", element: <BrowseProductsPage /> },
          { path: "sale/products/:productId", element: <VariantSelectorPage /> },
          { path: "sale/cart",  element: <CartPage /> },
          { path: "sale/success", element: <SaleSuccessPage /> },
          { path: "sales",      element: <AdminSalesListPage /> },
          { path: "sales/:saleId", element: <SaleDetailView /> },
          { path: "sales/:saleId/return", element: <AdminReturnSelectItemsPage /> },
          { path: "sales/:saleId/return/confirm", element: <AdminReturnConfirmPage /> },
          { path: "sales/:saleId/return/success", element: <AdminReturnSuccessPage /> },
        ] },

      // ── Purchases (requires purchases.view) ──────────────────────────────
      { element: <PermissionGuard requires="purchases.view" />,
        children: [
          { path: "purchases",  element: <AdminPurchasesPage /> },
          { path: "purchases/new", element: <RecordPurchasePage /> },
          { path: "purchases/payments", element: <SupplierPaymentsPage /> },
          { path: "purchases/:purchaseId", element: <PurchaseDetailPage /> },
        ] },

      // ── Payments (requires payments.view) ────────────────────────────────
      { element: <PermissionGuard requires="payments.view" />,
        children: [
          // ONE money book (owner, 2026-10-31). The general payment list, the recorded-entry
          // ledger and the statement were three views over the same movements; this route now
          // opens the one screen, and the old settings routes are aliases to the same page.
          { path: "payments",   element: <MoneyStatementPage /> },
          { path: "payments/supplier/:companyId", element: <RecordSupplierPaymentPage /> },
          { path: "payments/daily-cash", element: <DailyCashReconciliationPage /> },
          // Cash position is its own screen: the figure the Finance hub opens with, the money
          // that moved each way, and the last movements. The daily check stays beside it —
          // counting the till at closing time is a different job from reading the position.
          { path: "payments/cash-position", element: <CashPositionPage /> },
        ] },

      // ── Suppliers/Companies (requires companies.view) ────────────────────
      { element: <PermissionGuard requires="companies.view" />,
        children: [
          { path: "companies",  element: <CompaniesListPage /> },
          { path: "companies/new", element: <AddCompanyPage /> },
          { path: "companies/:companyId", element: <CompanyDetailPage /> },
        ] },

      // ── Access requests (requires employees.manage) ──────────────────────
      // A request is a staffing decision, not a read of the staff list. Keeping
      // these routes behind manage means a view-only role cannot see the
      // requester's phone number or close the request.
      { element: <PermissionGuard requires="employees.manage" />,
        children: [
          { path: "employees/requests", element: <EmployeeAccessRequestsPage /> },
          { path: "employees/requests/:requestId", element: <EmployeeAccessRequestDetailPage /> },
        ] },

      // ── Employees (requires employees.view) ──────────────────────────────
      { element: <PermissionGuard requires="employees.view" />,
        children: [
          { path: "employees",  element: <EmployeesListPage /> },
          { path: "employees/new", element: <AddEmployeePage /> },
          { path: "employees/:employeeId", element: <EmployeeDetailPage /> },
        ] },

      // ── Reports (requires reports.view) ──────────────────────────────────
      { element: <PermissionGuard requires="reports.view" />,
        children: [
          { path: "reports",    element: <AdminReportsPage /> },
        ] },

      // ── Settings (requires settings.view) ────────────────────────────────
      { element: <PermissionGuard requires="settings.view" />,
        children: [
          { path: "settings",   element: <AdminSettingsPage /> },
          { path: "settings/profile", element: <ProfileDetailsPage /> },
          // One hub per menu section: the jobs inside Sales, Finance, Branches and the rest,
          // listed from the same catalogue the menu itself reads (`lib/settingsHub`).
          //
          // Overview is the exception, and it is a screen rather than a menu (owner's
          // instruction, 2026-10-28): tapping Business Overview in Settings opens the business
          // performance dashboard itself — the period figures, the trend, the two balances and
          // the branch cards — instead of a list whose first row opened the same dashboard.
          { path: "settings/hub/overview", element: <BusinessOverviewPage /> },
          // Branches is a screen too: the section opens on the branch card itself — every
          // branch with its headcount, plus the row that creates another — rather than on four
          // job rows whose first one opened this same list (owner's reference, 2026-10-28).
          { path: "settings/hub/branches", element: <AdminBranchesSectionPage /> },
          // Reports is a screen of six destinations, not a list of jobs (owner's reference,
          // 2026-10-29): Sales, Profit, Customers, Suppliers, Inventory and Activity. It sits
          // before the generic `:sectionId` route so its own address cannot fall into it.
          { path: "settings/hub/reports", element: <AdminReportsHubPage /> },
          // Employees & Access is a directory, not a list of jobs (owner's reference,
          // 2026-10-29). The nested guard keeps the roster behind employees.view even though
          // the section itself lives in Settings; the old generic hub only needed settings.view
          // because every row opened a screen that carried its own guard.
          { element: <PermissionGuard requires="employees.view" />,
            children: [
              { path: "settings/hub/people", element: <AdminPeopleHubPage /> },
              { path: "settings/hub/people/branches", element: <AdminBranchAssignmentsPage /> },
              { path: "settings/hub/people/activity", element: <AdminEmployeeActivityPage /> },
              { path: "settings/hub/people/activity/:employeeId", element: <AdminEmployeeActivityDetailPage /> },
              // The roles list and one role's editor. `new` is declared before `:roleId` so a
              // new role can never be read as a role whose id is the word "new".
              { path: "settings/roles", element: <RolesAccessPage /> },
              { path: "settings/roles/new", element: <RoleEditorPage /> },
              { path: "settings/roles/:roleId", element: <RoleEditorPage /> },
            ] },
          // Profit used to share the general Reports page; it now has the screen the board gives
          // it, on the one profit calculation the rest of the app uses.
          { path: "settings/hub/reports/profit", element: <AdminProfitReportPage /> },
          { path: "settings/hub/sales", element: <AdminSalesSectionPage /> },
          { path: "settings/hub/inventory", element: <AdminInventorySectionPage /> },
          { path: "settings/hub/customers", element: <AdminCustomersSectionPage /> },
          { path: "settings/hub/purchases", element: <AdminPurchasesSectionPage /> },
          // Finance is a screen as well (owner's reference, 2026-10-29): the period's net profit,
          // the four balances, the performance arithmetic and the section's jobs. It sits before
          // the generic route so `/settings/hub/finance` cannot fall into the plain row list.
          { path: "settings/hub/finance", element: <AdminFinanceSectionPage /> },
          // Recording money that is not a sale — income, expense or a drawing (0254). The tab is
          // a query parameter, so the overflow menu and the section row open the same screen on
          // the kind they name, and a reload lands on the same tab.
          { path: "settings/hub/finance/record", element: <RecordMoneyPage /> },
          // The sentence and the form are one screen now (owner, 2026-10-31): typing a sentence
          // fills the fields below it, and the save still goes through `record_finance_entry`.
          // A saved quick link is forwarded to that one address rather than drawing a second copy.
          { path: "settings/hub/finance/quick", element: <Navigate to="/admin/settings/hub/finance/record" replace /> },
          // The recorded ledger and the statement are one list behind one screen. The visible
          // destination is `/settings/hub/finance/money`; this old URL forwards to it.
          { path: "settings/hub/finance/entries", element: <Navigate to="/admin/settings/hub/finance/money" replace /> },
          { path: "settings/hub/finance/money", element: <MoneyStatementPage /> },
          // The owner's payment diary, all of it (0257): customer, supplier and general notes in
          // one book, the way the cash screen's few reminders are one list. Its own screen checks
          // `payments.view` and redirects, so the address stays one plain route the screen index
          // can map.
          { path: "settings/hub/finance/reminders", element: <PaymentRemindersBookPage /> },
          { path: "settings/hub/:sectionId", element: <SectionHubPage /> },
          // One screen, one address. Business Overview used to be mounted here as well as at
          // `settings/hub/overview`, so the same dashboard answered to two URLs and a link could
          // point at either. The hub address is the one the Settings menu opens; this one now
          // redirects to it instead of drawing a second copy.
          { path: "settings/overview", element: <Navigate to="/admin/settings/hub/overview" replace /> },
          { path: "settings/overview/customers", element: <CustomerReceivablePage /> },
          { path: "settings/overview/customers/pending", element: <CustomerCreditPage mode="pending" /> },
          { path: "settings/overview/customers/overdue", element: <CustomerCreditPage mode="overdue" /> },
          { path: "settings/overview/suppliers", element: <SupplierPayablePage /> },
          { path: "settings/overview/suppliers/pending", element: <SupplierCreditPage mode="pending" /> },
          { path: "settings/overview/suppliers/overdue", element: <SupplierCreditPage mode="overdue" /> },
          // The payable book's supplier page and the directory's supplier page were the same
          // supplier drawn twice (2026-10-30). The merged page is the supplier's own record; this
          // address forwards to it so a bookmark still lands on the one page.
          { path: "settings/overview/suppliers/:companyId", element: <SupplierDetailRedirect /> },
          // The old branch-details screen was superseded by the Branches section and one
          // branch's own page; nothing links here, but the address survived in bookmarks.
          { path: "settings/branch-details", element: <Navigate to="/admin/settings/hub/branches" replace /> },
          { path: "settings/business", element: <BusinessProfilePage /> },
          // One branch's own page. The card list that used to live at `/settings/branches` is
          // gone (owner's instruction, 2026-10-28): the Branches section already lists every
          // branch in its card, and a second list whose only job was to open the first one's
          // rows was a screen with no question of its own.
          { path: "settings/branches/:branchId", element: <BranchDetailPage /> },
          // The deleted card list's address still lives in bookmarks and old links; it hands the
          // reader to the Branches section that replaced it rather than falling through to the
          // app root and the sign-in door.
          { path: "settings/branches", element: <Navigate to="/admin/settings/hub/branches" replace /> },
        ] },

      // ── Activity (requires activity.view) ────────────────────────────────
      { element: <PermissionGuard requires="activity.view" />,
        children: [
          { path: "activity",   element: <ActivityLogPage /> },
        ] },

      // ── Notifications (requires notifications.view) ──────────────────────
      { element: <PermissionGuard requires="notifications.view" />,
        children: [
          { path: "notifications", element: <AdminNotificationsPage /> },
        ] },

      // ── Alerts (requires alerts.view) ────────────────────────────────────
      { element: <PermissionGuard requires="alerts.view" />,
        children: [
          { path: "alerts/credit-overrides", element: <CreditOverridesPage /> },
          { path: "alerts/credit-overrides/:customerId", element: <CreditOverrideDetailPage /> },
          { path: "alerts/reminders", element: <RemindersOverviewPage /> },
          { path: "alerts/inventory", element: <InventoryAlertsPage /> },
          { path: "alerts/expiry", element: <ExpiryAlertsPage /> },
          { path: "alerts/credit-requests/:requestId", element: <CreditRequestDetailPage /> },
          { path: "alerts/groups/:groupId", element: <GroupDetailPage /> },
        ] },
    ],
  }],
  },

  {
    element: <ProtectedRoute />,
    children: [{
    path: "/employee",
    element: <EmployeeLayout />,
    children: [
      { index: true, element: <Navigate to="/employee/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "assistant", element: <AssistantPage /> },
      { path: "sale", element: <SelectCustomerPage /> },
      { path: "sale/products", element: <BrowseProductsPage /> },
      { path: "sale/products/:productId", element: <VariantSelectorPage /> },
      { path: "sale/cart", element: <CartPage /> },

      { path: "sale/success", element: <SaleSuccessPage /> },
      { path: "sales", element: <SalesListPage /> },
      { path: "sales/:saleId", element: <SaleDetailView /> },
      { path: "sales/:saleId/return", element: <ReturnSelectItemsPage /> },
      { path: "sales/:saleId/return/confirm", element: <ReturnConfirmPage /> },
      { path: "sales/:saleId/return/success", element: <ReturnSuccessPage /> },
      { path: "customers", element: <CustomersListPage /> },
      { path: "customers/new", element: <AddCustomerPage /> },
      { path: "customers/:customerId", element: <CustomerProfilePage /> },
      { path: "customers/:customerId/purchases", element: <CustomerPurchaseHistoryPage /> },
      { path: "customers/:customerId/payments", element: <CustomerPaymentHistoryPage /> },
      { path: "customers/:customerId/record-payment", element: <RecordCustomerPaymentPage /> },
      { path: "customers/:customerId/reminders", element: <ReminderHistoryPage /> },
      { path: "products", element: <ProductsListPage /> },
      { path: "products/:productId", element: <ProductDetailPage /> },
      // Inventory surfaces an employee may hold. The owner's grant is what puts the screen
      // in reach — each group carries the permission its own writes need, so an employee
      // granted "Add Product" finds a working Add Product screen here, on their own side,
      // and an employee without it is not walked into a page the database will refuse.
      { element: <PermissionGuard requires="products.create" fallback="/employee/products" />,
        children: [
          { path: "inventory/new", element: <AddProductPage /> },
        ] },
      { element: <PermissionGuard requires="products.edit" fallback="/employee/products" />,
        children: [
          { path: "inventory/:productId/edit", element: <AddProductPage /> },
          { path: "inventory/barcodes", element: <BarcodeGeneratePage /> },
        ] },
      { element: <PermissionGuard requires="inventory.adjust" fallback="/employee/products" />,
        children: [
          { path: "inventory/:productId/adjust", element: <InventoryAdjustPage /> },
        ] },
      { path: "search", element: <SearchPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "reports", element: <MyReportsPage /> },
      { path: "activity", element: <ActivityLogPage /> },
      { path: "notifications", element: <EmployeeNotificationsPage /> },
      { path: "more", element: <EmployeeMorePage /> },
      { path: "guide", element: <AppGuidePage /> },
    ],
  }],
  },

  // Any address the app does not have a screen for goes to the door rather than to React
  // Router's default error page. That page is written for the person who built the app — it
  // names `errorElement`, shows a stack and says "Hey developer" — and a shopkeeper who
  // follows a stale link or types half an address should land somewhere that works.
  { path: "*", element: <Navigate to="/" replace /> },
]);
