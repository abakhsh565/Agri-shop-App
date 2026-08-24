import svgPaths from "./svg-3nrg9wtku3";

function IosSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-signal">
          <path clipRule="evenodd" d={svgPaths.p2bb6eb80} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosWifiSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-wifi-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-wifi-signal">
          <path clipRule="evenodd" d={svgPaths.p646c5c0} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosBatteryFull() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="ios-battery-full">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g id="ios-battery-full">
          <path d={svgPaths.p66c9640} fill="black" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <IosSignal />
      <IosWifiSignal />
      <IosBatteryFull />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="content-stretch flex h-[44px] items-center justify-between px-[24px] relative shrink-0 w-full" data-name="status-bar">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">9:41</p>
      <StatusIcons />
    </div>
  );
}

function GreetingText() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="greeting-text">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[18px] text-black">Good morning, Ahmed</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Saturday, 26 October</p>
    </div>
  );
}

function UserBadge() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[18px] shrink-0 size-[36px]" data-name="user-badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">A</p>
    </div>
  );
}

function GreetingBar() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="greeting-bar">
      <GreetingText />
      <UserBadge />
    </div>
  );
}

function MetricCard() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">{`Today's Sales`}</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 45,200</p>
    </div>
  );
}

function MetricCard1() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Transactions</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">12</p>
    </div>
  );
}

function GridRow() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="grid-row-1">
      <MetricCard />
      <MetricCard1 />
    </div>
  );
}

function MetricCard2() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Customers Served</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">8</p>
    </div>
  );
}

function MetricCard3() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Credit Sales</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 12,400</p>
    </div>
  );
}

function GridRow1() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="grid-row-2">
      <MetricCard2 />
      <MetricCard3 />
    </div>
  );
}

function MetricsGrid() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start px-[16px] relative shrink-0 w-full" data-name="metrics-grid">
      <GridRow />
      <GridRow1 />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex flex-[1_0_0] h-[48px] items-center justify-center min-w-px relative rounded-[24px]" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">New Sale</p>
    </div>
  );
}

function BtnSecondary() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[48px] items-center justify-center min-w-px relative rounded-[24px]" data-name="btn-secondary">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Record Payment</p>
    </div>
  );
}

function ActionPills() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="action-pills">
      <BtnPrimary />
      <BtnSecondary />
    </div>
  );
}

function QuickActionsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="quick-actions-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black uppercase whitespace-nowrap">Quick Actions</p>
      <ActionPills />
    </div>
  );
}

function SaleInfo() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Rashid Ali</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">10:32 AM</p>
    </div>
  );
}

function StatusPaid() {
  return (
    <div className="bg-black content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-paid">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-white uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function SaleMeta() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 9,200</p>
      <StatusPaid />
    </div>
  );
}

function SaleRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <SaleInfo />
      <SaleMeta />
    </div>
  );
}

function SaleInfo1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Muhammad Asif</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">09:15 AM</p>
    </div>
  );
}

function StatusCredit() {
  return (
    <div className="content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-credit">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black uppercase whitespace-nowrap">Credit</p>
    </div>
  );
}

function SaleMeta1() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 14,000</p>
      <StatusCredit />
    </div>
  );
}

function SaleRow1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <SaleInfo1 />
      <SaleMeta1 />
    </div>
  );
}

function SaleInfo2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Zahid Khan</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">08:40 AM</p>
    </div>
  );
}

function StatusPaid1() {
  return (
    <div className="bg-black content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-paid">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-white uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function SaleMeta2() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 4,500</p>
      <StatusPaid1 />
    </div>
  );
}

function SaleRow2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-0 border-[#e5e5e5] border-solid inset-0 pointer-events-none" />
      <SaleInfo2 />
      <SaleMeta2 />
    </div>
  );
}

function RecentSalesList() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="recent-sales-list">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <SaleRow />
        <SaleRow1 />
        <SaleRow2 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function RecentSalesSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="recent-sales-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black uppercase whitespace-nowrap">Recent Sales</p>
      <RecentSalesList />
    </div>
  );
}

function DashboardBody() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="dashboard-body">
      <StatusBar />
      <GreetingBar />
      <MetricsGrid />
      <QuickActionsSection />
      <RecentSalesSection />
    </div>
  );
}

function Home() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="home">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="home">
          <path d={svgPaths.p2046d6b0} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconHome() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-home">
      <Home />
    </div>
  );
}

function TabHome() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Home">
      <IconHome />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Home</p>
    </div>
  );
}

function PlusCircle() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="plus-circle">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_10)" id="plus-circle">
          <path d={svgPaths.p1a4ad880} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_10">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function IconPlusCircle() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-plus-circle">
      <PlusCircle />
    </div>
  );
}

function TabNewSale() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-New Sale">
      <IconPlusCircle />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">New Sale</p>
    </div>
  );
}

function Receipt() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="receipt">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="receipt">
          <path d={svgPaths.p1dd1a080} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconReceipt() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-receipt">
      <Receipt />
    </div>
  );
}

function TabSales() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Sales">
      <IconReceipt />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Sales</p>
    </div>
  );
}

function Users() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="users">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="users">
          <path d={svgPaths.p1165c980} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconUsers() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-users">
      <Users />
    </div>
  );
}

function TabCustomers() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Customers">
      <IconUsers />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Customers</p>
    </div>
  );
}

function Package() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="package">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="package">
          <path d={svgPaths.p19b12c00} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconPackage() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-package">
      <Package />
    </div>
  );
}

function TabProducts() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Products">
      <IconPackage />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Products</p>
    </div>
  );
}

function NavTabs() {
  return (
    <div className="content-stretch flex h-[64px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="nav-tabs">
      <TabHome />
      <TabNewSale />
      <TabSales />
      <TabCustomers />
      <TabProducts />
    </div>
  );
}

function HomeIndicator() {
  return (
    <div className="content-stretch flex items-start justify-center py-[8px] relative shrink-0 w-full" data-name="home-indicator">
      <div className="bg-black h-[5px] relative rounded-[100px] shrink-0 w-[139px]" data-name="indicator-bar" />
    </div>
  );
}

function BottomNav() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="bottom-nav">
      <div aria-hidden className="absolute border-[#e5e5e5] border-solid border-t inset-0 pointer-events-none" />
      <NavTabs />
      <HomeIndicator />
    </div>
  );
}

export default function EmployeeDashboard() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="employee-dashboard">
      <DashboardBody />
      <BottomNav />
    </div>
  );
}