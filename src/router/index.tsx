import { createBrowserRouter, Navigate } from "react-router-dom";
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
import AdminDashboardPage from "@/pages/admin/dashboard/AdminDashboardPage";
import AdminSalesListPage from "@/pages/admin/sales/AdminSalesListPage";
import AdminSaleDetailPage from "@/pages/admin/sales/AdminSaleDetailPage";

import MoreMenuPage from "@/pages/admin/more/MoreMenuPage";
import EmployeesListPage from "@/pages/admin/employees/EmployeesListPage";
import EmployeeDetailPage from "@/pages/admin/employees/EmployeeDetailPage";
import CompaniesListPage from "@/pages/admin/companies/CompaniesListPage";
import AddCompanyPage from "@/pages/admin/companies/AddCompanyPage";
import CompanyDetailPage from "@/pages/admin/companies/CompanyDetailPage";
import AdminSettingsPage from "@/pages/admin/settings/AdminSettingsPage";
import AdminNotificationsPage from "@/pages/admin/notifications/AdminNotificationsPage";
import AddEmployeePage from "@/pages/admin/employees/AddEmployeePage";
import AdminPurchasesPage from "@/pages/admin/purchases/AdminPurchasesPage";
import RecordPurchasePage from "@/pages/admin/purchases/RecordPurchasePage";
import AdminPaymentsPage from "@/pages/admin/payments/AdminPaymentsPage";
import RecordSupplierPaymentPage from "@/pages/admin/payments/RecordSupplierPaymentPage";
import AdminReportsPage from "@/pages/admin/reports/AdminReportsPage";
import InventoryAdjustPage from "@/pages/admin/inventory/InventoryAdjustPage";
import AddProductPage from "@/pages/admin/inventory/AddProductPage";
import PurchaseDetailPage from "@/pages/admin/purchases/PurchaseDetailPage";
import StockMovementHistoryPage from "@/pages/admin/inventory/StockMovementHistoryPage";
import ReorderSuggestionsPage from "@/pages/admin/inventory/ReorderSuggestionsPage";
import DailyCashReconciliationPage from "@/pages/admin/payments/DailyCashReconciliationPage";

// Employee pages
import DashboardPage from "@/pages/employee/dashboard/DashboardPage";
import SelectCustomerPage from "@/pages/employee/sale/SelectCustomerPage";
import BrowseProductsPage from "@/pages/employee/sale/BrowseProductsPage";
import VariantSelectorPage from "@/pages/employee/sale/VariantSelectorPage";
import CartPage from "@/pages/employee/sale/CartPage";
import SaleSuccessPage from "@/pages/employee/sale/SaleSuccessPage";
import SalesListPage from "@/pages/employee/sales/SalesListPage";
import SaleDetailPage from "@/pages/employee/sales/SaleDetailPage";
import CustomersListPage from "@/pages/employee/customers/CustomersListPage";
import CustomerProfilePage from "@/pages/employee/customers/CustomerProfilePage";
import CustomerPurchaseHistoryPage from "@/pages/employee/customers/CustomerPurchaseHistoryPage";
import CustomerPaymentHistoryPage from "@/pages/employee/customers/CustomerPaymentHistoryPage";
import RecordCustomerPaymentPage from "@/pages/employee/customers/RecordCustomerPaymentPage";
import AddCustomerPage from "@/pages/employee/customers/AddCustomerPage";
import ProductsListPage from "@/pages/employee/products/ProductsListPage";
import ProductDetailPage from "@/pages/employee/products/ProductDetailPage";
import ReturnSelectItemsPage from "@/pages/employee/returns/ReturnSelectItemsPage";
import ReturnConfirmPage from "@/pages/employee/returns/ReturnConfirmPage";
import ReturnSuccessPage from "@/pages/employee/returns/ReturnSuccessPage";
import SearchPage from "@/pages/employee/search/SearchPage";
import SettingsPage from "@/pages/employee/settings/SettingsPage";
import ActivityLogPage from "@/pages/employee/activity/ActivityLogPage";
import EmployeeNotificationsPage from "@/pages/employee/notifications/EmployeeNotificationsPage";
import EmployeeMorePage from "@/pages/employee/more/MorePage";
import BarcodeGeneratePage from "@/pages/admin/inventory/BarcodeGeneratePage";
import AdminReturnSelectItemsPage from "@/pages/admin/returns/AdminReturnSelectItemsPage";
import AdminReturnConfirmPage from "@/pages/admin/returns/AdminReturnConfirmPage";
import AdminReturnSuccessPage from "@/pages/admin/returns/AdminReturnSuccessPage";

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
      { path: "sale",       element: <SelectCustomerPage /> },
      { path: "sale/products", element: <BrowseProductsPage /> },
      { path: "sale/products/:productId", element: <VariantSelectorPage /> },
      { path: "sale/cart",  element: <CartPage /> },

      { path: "sale/success", element: <SaleSuccessPage /> },
      { path: "sales",      element: <AdminSalesListPage /> },
      { path: "sales/:saleId", element: <AdminSaleDetailPage /> },
      { path: "inventory/new", element: <AddProductPage /> },
      { path: "inventory/:productId/edit", element: <AddProductPage /> },
      { path: "inventory/:productId/adjust", element: <InventoryAdjustPage /> },
      { path: "customers",  element: <CustomersListPage /> },
      { path: "customers/new", element: <AddCustomerPage /> },
      { path: "customers/:customerId", element: <CustomerProfilePage /> },
      { path: "customers/:customerId/purchases", element: <CustomerPurchaseHistoryPage /> },
      { path: "customers/:customerId/payments",  element: <CustomerPaymentHistoryPage /> },
      { path: "customers/:customerId/record-payment", element: <RecordCustomerPaymentPage /> },
      { path: "more",       element: <MoreMenuPage /> },
      { path: "employees",  element: <EmployeesListPage /> },
      { path: "employees/new", element: <AddEmployeePage /> },
      { path: "employees/:employeeId", element: <EmployeeDetailPage /> },
      { path: "companies",  element: <CompaniesListPage /> },
      { path: "companies/new", element: <AddCompanyPage /> },
      { path: "companies/:companyId", element: <CompanyDetailPage /> },
      { path: "settings",   element: <AdminSettingsPage /> },
      { path: "activity",   element: <ActivityLogPage /> },
      { path: "notifications", element: <AdminNotificationsPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "products",   element: <ProductsListPage /> },
      { path: "products/:productId", element: <ProductDetailPage /> },
      { path: "purchases",  element: <AdminPurchasesPage /> },
      { path: "purchases/new", element: <RecordPurchasePage /> },
      { path: "reports",    element: <AdminReportsPage /> },
      { path: "payments",   element: <AdminPaymentsPage /> },
      { path: "payments/supplier/:companyId", element: <RecordSupplierPaymentPage /> },
      { path: "payments/daily-cash", element: <DailyCashReconciliationPage /> },
      { path: "purchases/:purchaseId", element: <PurchaseDetailPage /> },
      { path: "inventory/movements", element: <StockMovementHistoryPage /> },
      { path: "inventory/reorder", element: <ReorderSuggestionsPage /> },
      { path: "inventory/barcodes", element: <BarcodeGeneratePage /> },
      { path: "sales/:saleId/return", element: <AdminReturnSelectItemsPage /> },
      { path: "sales/:saleId/return/confirm", element: <AdminReturnConfirmPage /> },
      { path: "sales/:saleId/return/success", element: <AdminReturnSuccessPage /> },
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
