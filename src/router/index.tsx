import { createBrowserRouter, Navigate } from "react-router-dom";
import React, { Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

// Auth
import SplashPage from "@/pages/auth/SplashPage";
import LoginPage from "@/pages/auth/LoginPage";
import OTPVerifyPage from "@/pages/auth/OTPVerifyPage";
import PINSetPage from "@/pages/auth/PINSetPage";
import PINLoginPage from "@/pages/auth/PINLoginPage";
import ForgotPINPage from "@/pages/auth/ForgotPINPage";
import NotRegisteredPage from "@/pages/auth/NotRegisteredPage";
import DeactivatedPage from "@/pages/auth/DeactivatedPage";
import UnderReviewPage from "@/pages/auth/UnderReviewPage";
import RejectedPage from "@/pages/auth/RejectedPage";
import SetupDemoPage from "@/pages/auth/SetupDemoPage";
import PermissionGuard from "@/components/auth/PermissionGuard";

// Registration
import RegisterPhonePage from "@/pages/register/RegisterPhonePage";
import RegisterOTPPage from "@/pages/register/RegisterOTPPage";
import RegisterShopDetailsPage from "@/pages/register/RegisterShopDetailsPage";
import RegisterStatusPage from "@/pages/register/RegisterStatusPage";

// Super Admin
import SuperAdminDashboard from "@/pages/super-admin/SuperAdminDashboard";

// Layout
import EmployeeLayout from "@/components/layout/EmployeeLayout";
import AdminLayout from "@/components/layout/AdminLayout";

// Admin pages
import ObservationBotPage from "@/pages/admin/more/ObservationBotPage";
const AdminDashboardPage = React.lazy(() => import("@/pages/admin/dashboard/AdminDashboardPage"));
const AdminSalesListPage = React.lazy(() => import("@/pages/admin/sales/AdminSalesListPage"));
const AdminSaleDetailPage = React.lazy(() => import("@/pages/admin/sales/AdminSaleDetailPage"));

import MoreMenuPage from "@/pages/admin/more/MoreMenuPage";
const EmployeesListPage = React.lazy(() => import("@/pages/admin/employees/EmployeesListPage"));
const EmployeeDetailPage = React.lazy(() => import("@/pages/admin/employees/EmployeeDetailPage"));
import CompaniesListPage from "@/pages/admin/companies/CompaniesListPage";
import AddCompanyPage from "@/pages/admin/companies/AddCompanyPage";
import CompanyDetailPage from "@/pages/admin/companies/CompanyDetailPage";
import AdminSettingsPage from "@/pages/admin/settings/AdminSettingsPage";
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
import SelectCustomerPage from "@/pages/employee/sale/SelectCustomerPage";
import BrowseProductsPage from "@/pages/employee/sale/BrowseProductsPage";
import VariantSelectorPage from "@/pages/employee/sale/VariantSelectorPage";
import CartPage from "@/pages/employee/sale/CartPage";
import SaleSuccessPage from "@/pages/employee/sale/SaleSuccessPage";
const SalesListPage = React.lazy(() => import("@/pages/employee/sales/SalesListPage"));
const SaleDetailPage = React.lazy(() => import("@/pages/employee/sales/SaleDetailPage"));
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
  { path: "/login", element: <LoginPage /> },
  { path: "/login/otp", element: <OTPVerifyPage /> },
  { path: "/login/pin-set", element: <PINSetPage /> },
  { path: "/login/pin", element: <PINLoginPage /> },
  { path: "/login/forgot-pin", element: <ForgotPINPage /> },
  { path: "/login/not-registered", element: <NotRegisteredPage /> },
  { path: "/login/deactivated", element: <DeactivatedPage /> },
  { path: "/login/under-review", element: <UnderReviewPage /> },
  { path: "/login/rejected", element: <RejectedPage /> },
  { path: "/setup-demo", element: <SetupDemoPage /> },

  // Registration flow
  { path: "/register", element: <RegisterPhonePage /> },
  { path: "/register/otp", element: <RegisterOTPPage /> },
  { path: "/register/shop-details", element: <RegisterShopDetailsPage /> },
  { path: "/register/status", element: <RegisterStatusPage /> },

  // Super Admin
  { path: "/super-admin", element: <SuperAdminDashboard /> },

  {
    element: <ProtectedRoute allowedRoles={["admin", "co_admin"]} />,
    children: [{
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: "dashboard",  element: <AdminDashboardPage /> },
      { path: "more",       element: <MoreMenuPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "observation-bot", element: <ObservationBotPage /> },

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
          { path: "sales/:saleId", element: <AdminSaleDetailPage /> },
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
      { path: "sale", element: <SelectCustomerPage /> },
      { path: "sale/products", element: <BrowseProductsPage /> },
      { path: "sale/products/:productId", element: <VariantSelectorPage /> },
      { path: "sale/cart", element: <CartPage /> },

      { path: "sale/success", element: <SaleSuccessPage /> },
      { path: "sales", element: <SalesListPage /> },
      { path: "sales/:saleId", element: <SaleDetailPage /> },
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
      { path: "activity", element: <ActivityLogPage /> },
      { path: "notifications", element: <EmployeeNotificationsPage /> },
      { path: "more", element: <EmployeeMorePage /> },
    ],
  }],
  },
]);
