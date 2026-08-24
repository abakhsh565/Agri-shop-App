import svgPaths from "./svg-ury1zp69sf";

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
        <g clipPath="url(#clip0_0_22)" id="wifi">
          <path clipRule="evenodd" d={svgPaths.p18941500} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_22">
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
        <g clipPath="url(#clip0_0_20)" id="battery">
          <path d={svgPaths.p7132ff1} fill="black" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_20">
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
        <g clipPath="url(#clip0_0_18)" id="arrowLeft">
          <g id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_18">
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Inventory Master</p>
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

function Search() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="search">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_16)" id="search">
          <path d={svgPaths.p32ba8780} fill="black" id="Vector" />
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

function SearchBar() {
  return (
    <div className="content-stretch flex gap-[8px] h-[44px] items-center px-[16px] relative rounded-[22px] shrink-0 w-full" data-name="search-bar">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[22px]" />
      <Search />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Geist:Regular',sans-serif] font-normal leading-[normal] min-w-px relative text-[#888] text-[14px]">Search products, chemicals...</p>
    </div>
  );
}

function PillActive() {
  return (
    <div className="bg-black content-stretch flex items-start px-[12px] py-[6px] relative rounded-[14px] shrink-0" data-name="pill-active">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-white whitespace-nowrap">All</p>
    </div>
  );
}

function PillInactive() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[12px] py-[6px] relative rounded-[14px] shrink-0" data-name="pill-inactive">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[11px] text-black whitespace-nowrap">Sprays</p>
    </div>
  );
}

function PillInactive1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[12px] py-[6px] relative rounded-[14px] shrink-0" data-name="pill-inactive">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[11px] text-black whitespace-nowrap">Seeds</p>
    </div>
  );
}

function PillInactive2() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[12px] py-[6px] relative rounded-[14px] shrink-0" data-name="pill-inactive">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[11px] text-black whitespace-nowrap">Fertilizers</p>
    </div>
  );
}

function FilterRow() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="filter-row">
      <PillActive />
      <PillInactive />
      <PillInactive1 />
      <PillInactive2 />
    </div>
  );
}

function SearchAndFilters() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="search-and-filters">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <SearchBar />
      <FilterRow />
    </div>
  );
}

function Info() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Cartap 4G</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">8 Kg Bag • Exp: Dec 2028</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black">Rs. 1,550</p>
    </div>
  );
}

function Badge() {
  return (
    <div className="bg-[#e5f7e5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">In Stock</p>
    </div>
  );
}

function StatusSide() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="status-side">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">450 Bags</p>
      <Badge />
    </div>
  );
}

function InventoryRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="inventory-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Info />
      <StatusSide />
    </div>
  );
}

function Info1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Virtako 40WG</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">100g Pack • Exp: Jun 2027</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black">Rs. 2,100</p>
    </div>
  );
}

function Badge1() {
  return (
    <div className="bg-[#fef3d6] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Low Stock</p>
    </div>
  );
}

function StatusSide1() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="status-side">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">12 Packs</p>
      <Badge1 />
    </div>
  );
}

function InventoryRow1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="inventory-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Info1 />
      <StatusSide1 />
    </div>
  );
}

function Info2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Gabara 10% EC</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">1 Litre • Exp: Oct 2026</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black">Rs. 1,350</p>
    </div>
  );
}

function Badge2() {
  return (
    <div className="bg-[#fce8e6] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Out of Stock</p>
    </div>
  );
}

function StatusSide2() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="status-side">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">0 Bottles</p>
      <Badge2 />
    </div>
  );
}

function InventoryRow2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="inventory-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Info2 />
      <StatusSide2 />
    </div>
  );
}

function Info3() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Tomato Hybrid F1</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">50g Pack • Exp: Jan 2028</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black">Rs. 950</p>
    </div>
  );
}

function Badge3() {
  return (
    <div className="bg-[#e5f7e5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">In Stock</p>
    </div>
  );
}

function StatusSide3() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="status-side">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">320 Packets</p>
      <Badge3 />
    </div>
  );
}

function InventoryRow3() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="inventory-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Info3 />
      <StatusSide3 />
    </div>
  );
}

function Info4() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Belt Expert Spray</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">500 ml • Exp: Sep 2026</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black">Rs. 2,450</p>
    </div>
  );
}

function Badge4() {
  return (
    <div className="bg-[#fce8e6] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Expired</p>
    </div>
  );
}

function StatusSide4() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="status-side">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">3 Bottles</p>
      <Badge4 />
    </div>
  );
}

function InventoryRow4() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="inventory-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Info4 />
      <StatusSide4 />
    </div>
  );
}

function Info5() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Diazinon 10G</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">5 Kg Bag • Exp: Mar 2027</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black">Rs. 1,800</p>
    </div>
  );
}

function Badge5() {
  return (
    <div className="bg-[#fef3d6] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[9px] text-black uppercase whitespace-nowrap">Low Stock</p>
    </div>
  );
}

function StatusSide5() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-end relative shrink-0" data-name="status-side">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">18 Bags</p>
      <Badge5 />
    </div>
  );
}

function InventoryRow5() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="inventory-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Info5 />
      <StatusSide5 />
    </div>
  );
}

function ListSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="list-section">
      <InventoryRow />
      <InventoryRow1 />
      <InventoryRow2 />
      <InventoryRow3 />
      <InventoryRow4 />
      <InventoryRow5 />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <SearchAndFilters />
      <ListSection />
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

export default function InventoryList() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="inventory-list">
      <Body />
      <BottomNav />
    </div>
  );
}