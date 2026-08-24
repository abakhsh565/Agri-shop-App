import svgPaths from "./svg-mktjajfh0g";

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

function Search() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="search">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="search">
          <path d={svgPaths.p3f6e0f00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function SearchActive() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[16px]" data-name="search-active">
      <Search />
    </div>
  );
}

function XCircle() {
  return (
    <div className="relative shrink-0 size-[10px]" data-name="x-circle">
      <svg className="absolute block inset-0 size-full" fill="none" height="10" preserveAspectRatio="none" viewBox="0 0 10 10" width="10">
        <g clipPath="url(#clip0_0_12)" id="x-circle">
          <path d={svgPaths.pda51f00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_12">
            <rect fill="white" height="10" width="10" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function ClearSearch() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[16px]" data-name="clear-search">
      <XCircle />
    </div>
  );
}

function SearchField() {
  return (
    <div className="content-stretch flex flex-[1_0_36px] gap-[8px] h-[44px] items-center min-w-px px-[16px] relative rounded-[22px]" data-name="search-field">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[22px]" />
      <SearchActive />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Geist:Bold',sans-serif] font-bold leading-[normal] min-w-px relative text-[14px] text-black">Janja</p>
      <ClearSearch />
    </div>
  );
}

function SearchActiveHeader() {
  return (
    <div className="content-stretch flex gap-[12px] items-center p-[16px] relative shrink-0 w-full" data-name="search-active-header">
      <SearchField />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Cancel</p>
    </div>
  );
}

function ShortcutPill() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="shortcut-pill">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Customers</p>
    </div>
  );
}

function ShortcutPill1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="shortcut-pill">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Products</p>
    </div>
  );
}

function ShortcutPill2() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="shortcut-pill">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Sales</p>
    </div>
  );
}

function ShortcutPill3() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="shortcut-pill">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Payments</p>
    </div>
  );
}

function ShortcutPills() {
  return (
    <div className="content-start flex flex-wrap gap-[8px] items-start relative shrink-0 w-full" data-name="shortcut-pills">
      <ShortcutPill />
      <ShortcutPill1 />
      <ShortcutPill2 />
      <ShortcutPill3 />
    </div>
  );
}

function QuickShortcutsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-full" data-name="quick-shortcuts-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">Quick Access</p>
      <ShortcutPills />
    </div>
  );
}

function Meta() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Janja Spray</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Product · FMC Corporation · 3 variants</p>
    </div>
  );
}

function Tag() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[8px] shrink-0" data-name="tag">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Product</p>
    </div>
  );
}

function ResultRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="result-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Meta />
      <Tag />
    </div>
  );
}

function Meta1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Janjua Brothers Farms</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Customer · +92 301 4455889</p>
    </div>
  );
}

function Tag1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[8px] shrink-0" data-name="tag">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Customer</p>
    </div>
  );
}

function ResultRow1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="result-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Meta1 />
      <Tag1 />
    </div>
  );
}

function ResultsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-full" data-name="results-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">{`Results for 'Janja'`}</p>
      <ResultRow />
      <ResultRow1 />
    </div>
  );
}

function Clock() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="clock">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_4)" id="clock">
          <path d={svgPaths.p8765900} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_4">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function ClockIcon() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[16px]" data-name="clock-icon">
      <Clock />
    </div>
  );
}

function RecentRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[14px] relative shrink-0 w-full" data-name="recent-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rashid Ali</p>
      <ClockIcon />
    </div>
  );
}

function Clock1() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="clock">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_4)" id="clock">
          <path d={svgPaths.p8765900} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_4">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function ClockIcon1() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[16px]" data-name="clock-icon">
      <Clock1 />
    </div>
  );
}

function RecentRow1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[14px] relative shrink-0 w-full" data-name="recent-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Wheat Seeds 5kg</p>
      <ClockIcon1 />
    </div>
  );
}

function Clock2() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="clock">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_4)" id="clock">
          <path d={svgPaths.p8765900} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_4">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function ClockIcon2() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[16px]" data-name="clock-icon">
      <Clock2 />
    </div>
  );
}

function RecentRow2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[14px] relative shrink-0 w-full" data-name="recent-row">
      <div aria-hidden className="absolute border-0 border-[#e5e5e5] border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Syngenta Fighter</p>
      <ClockIcon2 />
    </div>
  );
}

function RecentItems() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="recent-items">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <RecentRow />
        <RecentRow1 />
        <RecentRow2 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function RecentSearchesSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-full" data-name="recent-searches-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">Recent Searches</p>
      <RecentItems />
    </div>
  );
}

function SearchBodyContent() {
  return (
    <div className="content-stretch flex flex-col gap-[24px] items-start p-[16px] relative shrink-0 w-full" data-name="search-body-content">
      <QuickShortcutsSection />
      <ResultsSection />
      <RecentSearchesSection />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <SearchActiveHeader />
      <SearchBodyContent />
    </div>
  );
}

function Frame() {
  return <div className="h-[60px] relative shrink-0 w-full" data-name="Frame" />;
}

export default function SearchScreen() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="search-screen">
      <Body />
      <Frame />
    </div>
  );
}