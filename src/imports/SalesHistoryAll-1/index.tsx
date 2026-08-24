import svgPaths from "./svg-hcby860tcb";

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

function ArrowLeft() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="arrow-left">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="arrow-left">
          <path d={svgPaths.p931980} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[40px]" data-name="back-cta">
      <ArrowLeft />
    </div>
  );
}

function Search() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="search">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="search">
          <path d={svgPaths.p32de7700} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function SearchIconCta() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[40px]" data-name="search-icon-cta">
      <Search />
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Sales</p>
      <SearchIconCta />
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

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[14px] uppercase">{`Today's Sales`}</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Rs. 84,500</p>
    </div>
  );
}

function MetricCard() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="metric-card">
      <Frame2 />
    </div>
  );
}

function TabAll() {
  return (
    <div className="content-stretch flex flex-[1_0_32px] items-center justify-center min-w-px px-[16px] py-[10px] relative" data-name="tab-All">
      <div aria-hidden className="absolute border-b-2 border-black border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] overflow-hidden relative shrink-0 text-[13px] text-black text-ellipsis whitespace-nowrap">All</p>
    </div>
  );
}

function TabCredit() {
  return (
    <div className="content-stretch flex flex-[1_0_0] items-center justify-center min-w-px px-[16px] py-[10px] relative" data-name="tab-Credit">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] overflow-hidden relative shrink-0 text-[#808080] text-[13px] text-ellipsis whitespace-nowrap">Credit</p>
    </div>
  );
}

function TabPaid() {
  return (
    <div className="content-stretch flex flex-[1_0_0] items-center justify-center min-w-px px-[16px] py-[10px] relative" data-name="tab-Paid">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] overflow-hidden relative shrink-0 text-[#808080] text-[13px] text-ellipsis whitespace-nowrap">Paid</p>
    </div>
  );
}

function TabBar() {
  return (
    <div className="content-stretch flex items-center justify-center relative shrink-0 w-full" data-name="tab-bar">
      <div aria-hidden className="absolute border-[#d9d9d9] border-b border-solid inset-0 pointer-events-none" />
      <TabAll />
      <TabCredit />
      <TabPaid />
    </div>
  );
}

function ChipToday() {
  return (
    <div className="bg-black content-stretch flex items-start px-[16px] py-[4px] relative rounded-[16px] shrink-0" data-name="chip-today">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-white whitespace-nowrap">Today</p>
    </div>
  );
}

function ChipYesterday() {
  return (
    <div className="content-stretch flex items-start px-[16px] py-[4px] relative rounded-[16px] shrink-0" data-name="chip-yesterday">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Yesterday</p>
    </div>
  );
}

function ChipThisWeek() {
  return (
    <div className="content-stretch flex items-start px-[16px] py-[4px] relative rounded-[16px] shrink-0" data-name="chip-this-week">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] overflow-hidden relative shrink-0 text-[12px] text-black text-ellipsis whitespace-nowrap">This Week</p>
    </div>
  );
}

function TimeChipsRow() {
  return (
    <div className="content-stretch flex gap-[8px] items-start overflow-clip relative shrink-0 w-full" data-name="time-chips-row">
      <ChipToday />
      <ChipYesterday />
      <ChipThisWeek />
    </div>
  );
}

function SaleInfo() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold overflow-hidden relative shrink-0 text-[14px] text-black text-ellipsis w-full whitespace-nowrap">Rashid Ali</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] w-full">10:32 AM • Sold by Ahmed</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black text-right whitespace-nowrap">Rs. 9,200</p>
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
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold overflow-hidden relative shrink-0 text-[14px] text-black text-ellipsis w-full whitespace-nowrap">Muhammad Asif</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] w-full">09:15 AM • Sold by Ahmed</p>
    </div>
  );
}

function StatusCredit() {
  return (
    <div className="content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-credit">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black uppercase whitespace-nowrap">Credit Rs. 2,200</p>
    </div>
  );
}

function SaleMeta1() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black text-right whitespace-nowrap">Rs. 14,000</p>
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
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold overflow-hidden relative shrink-0 text-[14px] text-black text-ellipsis w-full whitespace-nowrap">Zahid Khan</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] w-full">08:40 AM • Sold by Ahmed</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black text-right whitespace-nowrap">Rs. 4,500</p>
      <StatusPaid1 />
    </div>
  );
}

function SaleRow2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <SaleInfo2 />
      <SaleMeta2 />
    </div>
  );
}

function SaleInfo3() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold overflow-hidden relative shrink-0 text-[14px] text-black text-ellipsis w-full whitespace-nowrap">Liaquat Ali</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] w-full">Yesterday • Sold by Ahmed</p>
    </div>
  );
}

function StatusCredit1() {
  return (
    <div className="content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-credit">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black uppercase whitespace-nowrap">Credit Rs. 10,000</p>
    </div>
  );
}

function SaleMeta3() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black text-right whitespace-nowrap">Rs. 22,500</p>
      <StatusCredit1 />
    </div>
  );
}

function SaleRow3() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <SaleInfo3 />
      <SaleMeta3 />
    </div>
  );
}

function SaleInfo4() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold overflow-hidden relative shrink-0 text-[14px] text-black text-ellipsis w-full whitespace-nowrap">Kamil Hassan</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] w-full">Yesterday • Sold by Ahmed</p>
    </div>
  );
}

function StatusPaid2() {
  return (
    <div className="bg-black content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-paid">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-white uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function SaleMeta4() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black text-right whitespace-nowrap">Rs. 6,800</p>
      <StatusPaid2 />
    </div>
  );
}

function SaleRow4() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <SaleInfo4 />
      <SaleMeta4 />
    </div>
  );
}

function SaleInfo5() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start leading-[normal] min-w-px relative" data-name="sale-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold overflow-hidden relative shrink-0 text-[14px] text-black text-ellipsis w-full whitespace-nowrap">Imran Shah</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] w-full">Yesterday • Sold by Ahmed</p>
    </div>
  );
}

function StatusPaid3() {
  return (
    <div className="bg-black content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="status-paid">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-white uppercase whitespace-nowrap">Paid</p>
    </div>
  );
}

function SaleMeta5() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="sale-meta">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black text-right whitespace-nowrap">Rs. 11,200</p>
      <StatusPaid3 />
    </div>
  );
}

function SaleRow5() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="sale-row">
      <div aria-hidden className="absolute border-0 border-[#e5e5e5] border-solid inset-0 pointer-events-none" />
      <SaleInfo5 />
      <SaleMeta5 />
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
        <SaleRow3 />
        <SaleRow4 />
        <SaleRow5 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function Frame1() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] items-start px-[16px] relative shrink-0 w-full" data-name="Frame">
      <MetricCard />
      <TabBar />
      <TimeChipsRow />
      <RecentSalesList />
    </div>
  );
}

function Frame() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] items-start relative shrink-0 w-full" data-name="Frame">
      <StatusBar />
      <ScreenHeader />
      <Frame1 />
    </div>
  );
}

function IconFrame() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="icon-frame">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="icon-frame">
          <path d={svgPaths.p2046d6b0} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconHome() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-Home">
      <IconFrame />
    </div>
  );
}

function TabHome() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Home">
      <IconHome />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Home</p>
    </div>
  );
}

function IconFrame1() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="icon-frame">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="icon-frame">
          <path d={svgPaths.p1f68d100} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconNewSale() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-New Sale">
      <IconFrame1 />
    </div>
  );
}

function TabNewSale() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-New Sale">
      <IconNewSale />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">New Sale</p>
    </div>
  );
}

function IconFrame2() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="icon-frame">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="icon-frame">
          <path d={svgPaths.p157d680} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconSales() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-Sales">
      <IconFrame2 />
    </div>
  );
}

function TabSales() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Sales">
      <IconSales />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Sales</p>
    </div>
  );
}

function IconFrame3() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="icon-frame">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="icon-frame">
          <path d={svgPaths.p39d26d00} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconCustomers() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-Customers">
      <IconFrame3 />
    </div>
  );
}

function TabCustomers() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Customers">
      <IconCustomers />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Customers</p>
    </div>
  );
}

function IconFrame4() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="icon-frame">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="icon-frame">
          <path d={svgPaths.p18b82200} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconProducts() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-Products">
      <IconFrame4 />
    </div>
  );
}

function TabProducts() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Products">
      <IconProducts />
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

function DashboardBody() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col items-start justify-between min-h-px relative w-full" data-name="dashboard-body">
      <Frame />
      <BottomNav />
    </div>
  );
}

export default function SalesHistoryAll() {
  return (
    <div className="bg-white relative size-full" data-name="sales-history-all">
      <div className="content-stretch flex flex-col items-start min-h-[inherit] relative size-full">
        <DashboardBody />
      </div>
      <div aria-hidden className="absolute border border-[#cfd8dc] border-solid inset-0 pointer-events-none" />
    </div>
  );
}