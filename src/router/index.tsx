import { createBrowserRouter, Navigate } from "react-router-dom";
import React, { Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

// Auth
import SplashPage from "@/pages/auth/SplashPage";
import LoginPage from "@/pages/auth/LoginPage";
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
// One sale record for both shells. It was two pages that drifted apart (one printed cost and
// profit under every line, the other did not; neither showed the sale number), so the screen
// is shared and the numbers it shows follow the signed-in role.
const SaleDetailView = React.lazy(() => import("@/components/sales/SaleDetailView"));

import MoreMenuPage from "@/pages/admin/more/MoreMenuPage";
import AdminMessagesPage from "@/pages/admin/messages/AdminMessagesPage";
import BranchDetailPage from "@/pages/admin/more/BranchDetailPage";
const EmployeesListPage = React.lazy(() => import("@/pages/admin/employees/EmployeesListPage"));
const EmployeeDetailPage = React.lazy(() => import("@/pages/admin/employees/EmployeeDetailPage"));
import CompaniesListPage from "@/pages/admin/companies/CompaniesListPage";
import AddCompanyPage from "@/pages/admin/companies/AddCompanyPage";
import CompanyDetailPage from "@/pages/admin/companies/CompanyDetailPage";
import AdminSettingsPage from "@/pages/admin/settings/AdminSettingsPage";
import ProfileDetailsPage from "@/pages/admin/settings/ProfileDetailsPage";
import RolesAccessPage from "@/pages/admin/settings/RolesAccessPage";
import AdminNotificationsPage from "@/pages/admin/notifications/AdminNotificationsPage";
import AddEmployeePage from "@/pages/admin/employees/AddEmployeePage";
const AdminPurchasesPage = React.lazy(() => import("@/pages/admin/purchases/AdminPurchasesPage"));
const RecordPurchasePage = React.lazy(() => import("@/pages/admin/purchases/RecordPurchasePage"));
import AdminPaymentsPage from "@/pages/admin/payments/AdminPaymentsPage";
import RecordSupplierPaymentPage from "@/pages/admin/payments/RecordSupplierPaymentPage";
const AdminReportsPage = React.lazy(() => import("@/pages/admin/reports/AdminReportsPage"));
const InventoryAdjustPage = React.lazy(() => import("@/pages/admin/inventory/InventoryAdjustPage"));
const AddProductPage = React.lazy(() => import("@/pages/admin/inventory/AddProductPage"));
import PurchaseDetailPage from "@/pages/admin/purchases/PurchaseDetailPage";
import StockMovementHistoryPage from "@/pages/admin/inventory/StockMovementHistoryPage";
import ReorderSuggestionsPage from "@/pages/admin/inventory/ReorderSuggestionsPage";
import DailyCashReconciliationPage from "@/pages/admin/payments/DailyCashReconciliationPage";

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
import InventoryAlertsPage from "@/pages/admin/alerts/InventoryAlertsPage";
import GroupDetailPage from "@/pages/admin/alerts/GroupDetailPage";

export const router = createBrowserRouter([
  { path: "/", element: <SplashPage /> },
  // Shown once per device, before sign-in: what the app is for, in three screens.
  { path: "/welcome", element: <IntroPage /> },
  { path: "/login", element: <LoginPage /> },
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
      { path: "more",       element: <MoreMenuPage /> },
      { path: "messages",   element: <AdminMessagesPage /> },
      { path: "guide",      element: <AppGuidePage /> },
      { path: "search", element: <SearchPage /> },

      // ── Customers (requires customers.view) ──────────────────────────────
      { element: <PermissionGuard requires="customers.view" />,
        children: [
          { path: "customers",  element: <CustomersListPage /> },
          { path: "customers/new", element: <AddCustomerPage /> },
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
          { path: "inventory/:productId/edit", element: <AddProductPage /> },
          { path: "inventory/:productId/adjust", element: <InventoryAdjustPage /> },
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
          { path: "purchases/:purchaseId", element: <PurchaseDetailPage /> },
        ] },

      // ── Payments (requires payments.view) ────────────────────────────────
      { element: <PermissionGuard requires="payments.view" />,
        children: [
          { path: "payments",   element: <AdminPaymentsPage /> },
          { path: "payments/supplier/:companyId", element: <RecordSupplierPaymentPage /> },
          { path: "payments/daily-cash", element: <DailyCashReconciliationPage /> },
        ] },

      // ── Suppliers/Companies (requires companies.view) ────────────────────
      { element: <PermissionGuard requires="companies.view" />,
        children: [
          { path: "companies",  element: <CompaniesListPage /> },
          { path: "companies/new", element: <AddCompanyPage /> },
          { path: "companies/:companyId", element: <CompanyDetailPage /> },
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
          { path: "settings/branches/:branchId", element: <BranchDetailPage /> },
          { path: "settings/roles", element: <RolesAccessPage /> },
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
]);
