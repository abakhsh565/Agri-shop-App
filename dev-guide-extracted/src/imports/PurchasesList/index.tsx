import svgPaths from "./svg-3v2j2kd7t3";

function Signal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_14)" id="signal">
          <path clipRule="evenodd" d={svgPaths.p159df970} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_14">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Wifi() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="wifi">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_20)" id="wifi">
          <path clipRule="evenodd" d={svgPaths.p18941500} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_20">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Battery() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="battery">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g clipPath="url(#clip0_0_18)" id="battery">
          <path d={svgPaths.p7132ff1} fill="black" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_18">
            <rect fill="white" height="20" width="28" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <Signal />
      <Wifi />
      <Battery />
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

function ArrowLeft() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="arrowLeft">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_16)" id="arrowLeft">
          <g id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_16">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Dashboard</p>
    </div>
  );
}

function Frame() {
  return <div className="h-px relative shrink-0 w-[60px]" data-name="Frame" />;
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Purchases</p>
      <Frame />
    </div>
  );
}

function ScreenHeader() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="screen-header">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <HeaderRow />
    </div>
  );
}

function BtnAddPurchase() {
  return (
    <div className="bg-black content-stretch flex items-start px-[12px] py-[6px] relative rounded-[16px] shrink-0" data-name="btn-add-purchase">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-white whitespace-nowrap">+ New Purchase</p>
    </div>
  );
}

function ActionsBar() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="actions-bar">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black uppercase whitespace-nowrap">Recent Stocks In</p>
      <BtnAddPurchase />
    </div>
  );
}

function Details() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="details">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">FMC Corporation</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Cartap 4G (Pesticide) • 120 Bags</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Yesterday</p>
    </div>
  );
}

function StatusBadge() {
  return (
    <div className="bg-[#e5f7e5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function Meta() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 1,44,000</p>
      <StatusBadge />
    </div>
  );
}

function PurchaseCard() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="purchase-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Details />
      <Meta />
    </div>
  );
}

function Details1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="details">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Syngenta</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Virtako 40WG • 50 Packs</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">24 Oct 2026</p>
    </div>
  );
}

function StatusBadge1() {
  return (
    <div className="bg-white content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-badge">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Credit</p>
    </div>
  );
}

function Meta1() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 95,000</p>
      <StatusBadge1 />
    </div>
  );
}

function PurchaseCard1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="purchase-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Details1 />
      <Meta1 />
    </div>
  );
}

function Details2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="details">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Bayer Crop</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Belt Expert • 30 Bottles</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">18 Oct 2026</p>
    </div>
  );
}

function StatusBadge2() {
  return (
    <div className="bg-[#e5f7e5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function Meta2() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 67,500</p>
      <StatusBadge2 />
    </div>
  );
}

function PurchaseCard2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="purchase-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Details2 />
      <Meta2 />
    </div>
  );
}

function Details3() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="details">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Four Brothers</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Gabara 10% EC • 100 Cartons</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">12 Oct 2026</p>
    </div>
  );
}

function StatusBadge3() {
  return (
    <div className="bg-[#e5f7e5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function Meta3() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 1,10,000</p>
      <StatusBadge3 />
    </div>
  );
}

function PurchaseCard3() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="purchase-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Details3 />
      <Meta3 />
    </div>
  );
}

function Details4() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="details">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Sakata Seeds</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Tomato Hybrid F1 • 200 Packets</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">05 Oct 2026</p>
    </div>
  );
}

function StatusBadge4() {
  return (
    <div className="bg-white content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-badge">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Credit</p>
    </div>
  );
}

function Meta4() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 1,80,000</p>
      <StatusBadge4 />
    </div>
  );
}

function PurchaseCard4() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="purchase-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Details4 />
      <Meta4 />
    </div>
  );
}

function PurchasesScrollList() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start px-[16px] relative shrink-0 w-full" data-name="purchases-scroll-list">
      <PurchaseCard />
      <PurchaseCard1 />
      <PurchaseCard2 />
      <PurchaseCard3 />
      <PurchaseCard4 />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <ActionsBar />
      <PurchasesScrollList />
    </div>
  );
}

function TabIcon() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p29a89900} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabDashboard() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Dashboard">
      <TabIcon />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Dashboard</p>
    </div>
  );
}

function TabIcon1() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p13ffb080} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
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
          <path d={svgPaths.p1c461170} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabInventory() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Inventory">
      <TabIcon2 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Inventory</p>
    </div>
  );
}

function TabIcon3() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p37b600c0} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
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
          <path d={svgPaths.pa7a13c0} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
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

export default function PurchasesList() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="purchases-list">
      <Body />
      <BottomNav />
    </div>
  );
}