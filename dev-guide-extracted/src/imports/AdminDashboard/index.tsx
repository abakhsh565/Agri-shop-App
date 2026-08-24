import svgPaths from "./svg-a6ra3zb9x6";

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
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[20px] text-black">Good morning, Owner</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Aug 8, 2026</p>
    </div>
  );
}

function UserBadge() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[18px] shrink-0 size-[36px]" data-name="user-badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">O</p>
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

function FilterPillActive() {
  return (
    <div className="bg-black content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="filter-pill-active">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-white whitespace-nowrap">Today</p>
    </div>
  );
}

function FilterPill() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="filter-pill">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Yesterday</p>
    </div>
  );
}

function FilterPill1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="filter-pill">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">This Week</p>
    </div>
  );
}

function FilterPill2() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="filter-pill">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">This Month</p>
    </div>
  );
}

function DateFilterRow() {
  return (
    <div className="content-stretch flex gap-[8px] items-start pb-[12px] px-[16px] relative shrink-0 w-full" data-name="date-filter-row">
      <FilterPillActive />
      <FilterPill />
      <FilterPill1 />
      <FilterPill2 />
    </div>
  );
}

function MetricCard() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Total Sales</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 1,25,400</p>
    </div>
  );
}

function MetricCard1() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Transactions</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">34</p>
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

function Frame() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal gap-[4px] items-center leading-[normal] relative shrink-0 text-[11px] whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[#888] uppercase">Gross Profit</p>
      <p className="relative shrink-0 text-black">▲</p>
    </div>
  );
}

function MetricCard2() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 28,600</p>
    </div>
  );
}

function MetricCard3() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Outstanding Credit</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 48,200</p>
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

function MetricCardHalf() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="metric-card-half">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[10px] uppercase">Paid Sales</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[15px] text-black">Rs. 77,200</p>
    </div>
  );
}

function MetricCardHalf1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="metric-card-half">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[10px] uppercase">Credit Sales</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[15px] text-black">Rs. 48,200</p>
    </div>
  );
}

function GridRowSplit() {
  return (
    <div className="[word-break:break-word] content-stretch flex gap-[12px] items-start leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="grid-row-split">
      <MetricCardHalf />
      <MetricCardHalf1 />
    </div>
  );
}

function MetricsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start pb-[12px] px-[16px] relative shrink-0 w-full" data-name="metrics-section">
      <GridRow />
      <GridRow1 />
      <GridRowSplit />
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">QUICK ACTIONS</p>
      <ActionPills />
    </div>
  );
}

function AlertRow() {
  return (
    <div className="content-stretch flex items-start p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="alert-row">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">• 3 products low stock</p>
    </div>
  );
}

function AlertRow1() {
  return (
    <div className="content-stretch flex items-start p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="alert-row">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">• 2 products expiring soon</p>
    </div>
  );
}

function AlertRow2() {
  return (
    <div className="content-stretch flex items-start p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="alert-row">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">• Rs. 1,20,000 supplier payable</p>
    </div>
  );
}

function AlertsList() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="alerts-list">
      <AlertRow />
      <AlertRow1 />
      <AlertRow2 />
    </div>
  );
}

function AlertsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="alerts-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black uppercase whitespace-nowrap">Quick Alerts</p>
      <AlertsList />
    </div>
  );
}

function EmployeeRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="employee-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Ahmed (Sales Employee)</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 85,000</p>
    </div>
  );
}

function EmployeeRow1() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-center justify-between leading-[normal] p-[16px] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="employee-row">
      <p className="relative shrink-0">Bilal (Delivery Boy)</p>
      <p className="relative shrink-0">Rs. 40,400</p>
    </div>
  );
}

function EmployeeList() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="employee-list">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <EmployeeRow />
        <EmployeeRow1 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function EmployeeSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="employee-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black uppercase whitespace-nowrap">Employee Performance</p>
      <EmployeeList />
    </div>
  );
}

function BodyContent() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body-content">
      <StatusBar />
      <GreetingBar />
      <DateFilterRow />
      <MetricsSection />
      <QuickActionsSection />
      <AlertsSection />
      <EmployeeSection />
    </div>
  );
}

function TabIcon() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p24bb9300} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabDashboard() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Dashboard">
      <TabIcon />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Dashboard</p>
    </div>
  );
}

function TabIcon1() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p3c269300} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabSales() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Sales">
      <TabIcon1 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Sales</p>
    </div>
  );
}

function TabIcon2() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p2ddf9000} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabInventory() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Inventory">
      <TabIcon2 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Inventory</p>
    </div>
  );
}

function TabIcon3() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p2e5cb170} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabCustomers() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Customers">
      <TabIcon3 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Customers</p>
    </div>
  );
}

function TabIcon4() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p2db2b980} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabMore() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-More">
      <TabIcon4 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">More</p>
    </div>
  );
}

function NavTabs() {
  return (
    <div className="content-stretch flex h-[64px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="nav-tabs">
      <TabDashboard />
      <TabSales />
      <TabInventory />
      <TabCustomers />
      <TabMore />
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

export default function AdminDashboard() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="admin-dashboard">
      <BodyContent />
      <BottomNav />
    </div>
  );
}